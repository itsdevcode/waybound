import logging
import math
import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.geo import calculate_haversine_distance_meters, calculate_profile_level
from app.core.security import create_invite_token, hash_token
from app.models.party import (
    MemberVerification,
    Party,
    PartyMembership,
    PartyQuest,
    SplitClue,
)
from app.models.profile import Profile
from app.models.quest import Quest
from app.models.quest_step import QuestStep
from app.models.user import User
from app.schemas.party import (
    ConsentRevealRequest,
    PartyCreateRequest,
    PartyJoinRequest,
    PartyMemberPublicResponse,
    PartyResponse,
    PartyStartQuestRequest,
    PartyVerificationResponse,
    PartyVerifyRequest,
    SharedPartyQuestResponse,
    SplitClueResponse,
)
from app.schemas.quest import QuestCreateRequest
from app.services.providers.base import QuestProvider

logger = logging.getLogger(__name__)


class PartyServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class PartyNotFoundError(PartyServiceError):
    def __init__(self, message: str = "Party not found") -> None:
        super().__init__(message, status_code=404)


class PartyAccessForbiddenError(PartyServiceError):
    def __init__(self, message: str = "You are not a member of this party") -> None:
        super().__init__(message, status_code=403)


class PartyConflictError(PartyServiceError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=409)


class PartyService:
    def __init__(
        self,
        session: AsyncSession,
        quest_provider: QuestProvider,
    ) -> None:
        self.session = session
        self.provider = quest_provider

    async def _get_party_with_members(
        self,
        party_id: uuid.UUID,
        for_update: bool = False,
    ) -> Party:
        stmt = (
            select(Party)
            .options(
                selectinload(Party.memberships).selectinload(PartyMembership.user),
                selectinload(Party.party_quest)
                .selectinload(PartyQuest.split_clues),
                selectinload(Party.party_quest)
                .selectinload(PartyQuest.quest),
            )
            .where(Party.id == party_id)
        )
        if for_update:
            stmt = stmt.with_for_update()

        result = await self.session.execute(stmt)
        party = result.scalars().first()
        if not party:
            raise PartyNotFoundError(f"Party {party_id} not found")
        return party

    def _format_members(
        self,
        party: Party,
        current_user_id: uuid.UUID,
        verifications_map: dict[uuid.UUID, MemberVerification] | None = None,
    ) -> list[PartyMemberPublicResponse]:
        active_members = [m for m in party.memberships if m.status == "active"]
        # Check mutual identity reveal consent
        both_consented = len(active_members) == 2 and all(m.consent_reveal_identity for m in active_members)

        res: list[PartyMemberPublicResponse] = []
        for m in active_members:
            # If both consented, real name is revealed. Otherwise display nickname.
            reveal = both_consented
            display_name = m.user.name if reveal else (m.nickname or m.user.name)

            ver = verifications_map.get(m.user_id) if verifications_map else None

            res.append(
                PartyMemberPublicResponse(
                    user_id=m.user_id,
                    slot_number=m.slot_number,
                    role=m.role,
                    status=m.status,
                    display_name=display_name,
                    is_real_name_revealed=both_consented,
                    joined_at=m.joined_at,
                    has_verified=ver.verified if ver else False,
                    reward_xp_awarded=ver.reward_xp_awarded if ver else 0,
                )
            )
        return res

    async def create_party(
        self,
        user: User,
        request: PartyCreateRequest,
    ) -> PartyResponse:
        # Check if user is already an active member of an open or active party
        existing_stmt = (
            select(PartyMembership)
            .join(Party)
            .where(
                PartyMembership.user_id == user.id,
                PartyMembership.status == "active",
                Party.status.in_(["open", "active"]),
            )
        )
        existing = (await self.session.execute(existing_stmt)).scalars().first()
        if existing:
            raise PartyConflictError("You already have an active or open party. Leave or complete it before creating a new one.")

        raw_token, token_hash, expires_at = create_invite_token()

        party = Party(
            host_id=user.id,
            name=request.name.strip() or "Mystery Fellowship",
            status="open",
            invite_token_hash=token_hash,
            invite_expires_at=expires_at,
        )
        self.session.add(party)
        await self.session.flush()

        # Add host as slot 1
        membership = PartyMembership(
            party_id=party.id,
            user_id=user.id,
            role="host",
            status="active",
            slot_number=1,
            nickname=request.nickname.strip() or "Pathfinder",
            consent_reveal_identity=False,
        )
        self.session.add(membership)
        await self.session.commit()

        # Re-fetch populated
        full_party = await self._get_party_with_members(party.id)
        members = self._format_members(full_party, user.id)

        return PartyResponse(
            id=full_party.id,
            name=full_party.name,
            status=full_party.status,
            host_id=full_party.host_id,
            created_at=full_party.created_at,
            members=members,
            invite_token=raw_token,  # Exposed only to the creator once
            invite_expires_at=full_party.invite_expires_at,
            has_active_quest=False,
            party_quest_id=None,
        )

    async def join_party(
        self,
        user: User,
        request: PartyJoinRequest,
    ) -> PartyResponse:
        token_hash = hash_token(request.invite_token.strip())
        now = datetime.now(timezone.utc)

        # Atomic transaction with row lock on Party
        if not self.session.in_transaction():
            await self.session.begin()

        party_stmt = (
            select(Party)
            .options(selectinload(Party.memberships))
            .where(Party.invite_token_hash == token_hash)
            .with_for_update()
        )
        party = (await self.session.execute(party_stmt)).scalars().first()

        if not party:
            raise PartyNotFoundError("Invalid or non-existent party invitation.")

        if party.status != "open":
            raise PartyConflictError(f"Cannot join party: party is currently {party.status}.")

        if party.invite_expires_at and party.invite_expires_at <= now:
            raise PartyConflictError("Invitation token has expired. Request a new invite from the host.")

        # Check existing active party membership
        existing_stmt = (
            select(PartyMembership)
            .join(Party)
            .where(
                PartyMembership.user_id == user.id,
                PartyMembership.status == "active",
                Party.status.in_(["open", "active"]),
            )
        )
        existing = (await self.session.execute(existing_stmt)).scalars().first()
        if existing and existing.party_id != party.id:
            raise PartyConflictError("You are already in an active party. Leave it before joining another.")

        # Check membership capacity (maximum 2 active members)
        active_members = [m for m in party.memberships if m.status == "active"]
        already_member = next((m for m in active_members if m.user_id == user.id), None)
        if already_member:
            # Rejoining existing membership
            full_party = await self._get_party_with_members(party.id)
            members = self._format_members(full_party, user.id)
            return PartyResponse(
                id=full_party.id,
                name=full_party.name,
                status=full_party.status,
                host_id=full_party.host_id,
                created_at=full_party.created_at,
                members=members,
                has_active_quest=full_party.party_quest is not None,
                party_quest_id=full_party.party_quest.id if full_party.party_quest else None,
            )

        if len(active_members) >= 2:
            raise PartyConflictError("Party is full (maximum 2 explorers).")

        # Determine slot: slot 2 for partner
        taken_slots = {m.slot_number for m in active_members}
        new_slot = 2 if 1 in taken_slots else 1

        new_membership = PartyMembership(
            party_id=party.id,
            user_id=user.id,
            role="member",
            status="active",
            slot_number=new_slot,
            nickname=request.nickname.strip() or "Wayfarer",
            consent_reveal_identity=False,
        )
        new_membership.party = party
        new_membership.user = user
        self.session.add(new_membership)

        # Invalidate invitation token once party is full to prevent reuse
        party.status = "active"
        party.invite_token_hash = None
        party.invite_expires_at = None
        party_id = party.id

        await self.session.commit()

        full_party = await self._get_party_with_members(party_id)
        members = self._format_members(full_party, user.id)
        return PartyResponse(
            id=full_party.id,
            name=full_party.name,
            status=full_party.status,
            host_id=full_party.host_id,
            created_at=full_party.created_at,
            members=members,
            has_active_quest=full_party.party_quest is not None,
            party_quest_id=full_party.party_quest.id if full_party.party_quest else None,
        )

    async def get_party(
        self,
        party_id: uuid.UUID,
        user: User,
    ) -> PartyResponse:
        party = await self._get_party_with_members(party_id)
        active_members = [m for m in party.memberships if m.status == "active"]
        is_member = any(m.user_id == user.id for m in active_members)

        if not is_member and party.status != "open":
            raise PartyAccessForbiddenError()

        # Load verifications if quest exists
        verifications_map: dict[uuid.UUID, MemberVerification] = {}
        if party.party_quest:
            v_stmt = select(MemberVerification).where(MemberVerification.party_quest_id == party.party_quest.id)
            v_list = (await self.session.execute(v_stmt)).scalars().all()
            for v in v_list:
                verifications_map[v.user_id] = v

        members = self._format_members(party, user.id, verifications_map)

        return PartyResponse(
            id=party.id,
            name=party.name,
            status=party.status,
            host_id=party.host_id,
            created_at=party.created_at,
            members=members,
            has_active_quest=party.party_quest is not None,
            party_quest_id=party.party_quest.id if party.party_quest else None,
        )

    async def list_user_parties(
        self,
        user: User,
    ) -> list[PartyResponse]:
        stmt = (
            select(Party)
            .join(PartyMembership)
            .options(
                selectinload(Party.memberships).selectinload(PartyMembership.user),
                selectinload(Party.party_quest),
            )
            .where(
                PartyMembership.user_id == user.id,
                PartyMembership.status == "active",
            )
            .order_by(Party.created_at.desc())
        )
        parties = (await self.session.execute(stmt)).scalars().all()
        res: list[PartyResponse] = []
        for p in parties:
            members = self._format_members(p, user.id)
            res.append(
                PartyResponse(
                    id=p.id,
                    name=p.name,
                    status=p.status,
                    host_id=p.host_id,
                    created_at=p.created_at,
                    members=members,
                    has_active_quest=p.party_quest is not None,
                    party_quest_id=p.party_quest.id if p.party_quest else None,
                )
            )
        return res

    async def leave_party(
        self,
        party_id: uuid.UUID,
        user: User,
    ) -> PartyResponse:
        party = await self._get_party_with_members(party_id, for_update=True)
        active_members = [m for m in party.memberships if m.status == "active"]
        membership = next((m for m in active_members if m.user_id == user.id), None)

        if not membership:
            raise PartyAccessForbiddenError()

        # If host leaves, disband party
        if membership.role == "host":
            return await self.disband_party(party_id, user)

        membership.status = "left"
        membership.left_at = datetime.now(timezone.utc)

        # If party was active with quest, mark quest as abandoned
        if party.party_quest and party.party_quest.status == "active":
            party.party_quest.status = "abandoned"

        party.status = "open"
        # Regenerate invite token so host can invite someone else
        raw_token, token_hash, expires_at = create_invite_token()
        party.invite_token_hash = token_hash
        party.invite_expires_at = expires_at

        await self.session.commit()
        full_party = await self._get_party_with_members(party_id)
        members = self._format_members(full_party, user.id)
        return PartyResponse(
            id=full_party.id,
            name=full_party.name,
            status=full_party.status,
            host_id=full_party.host_id,
            created_at=full_party.created_at,
            members=members,
            has_active_quest=False,
            party_quest_id=None,
        )

    async def disband_party(
        self,
        party_id: uuid.UUID,
        user: User,
    ) -> PartyResponse:
        party = await self._get_party_with_members(party_id, for_update=True)
        if party.host_id != user.id:
            raise PartyServiceError("Only the party host can disband the fellowship.", status_code=403)

        party.status = "disbanded"
        party.invite_token_hash = None
        party.invite_expires_at = None

        now = datetime.now(timezone.utc)
        for m in party.memberships:
            if m.status == "active":
                m.status = "left"
                m.left_at = now

        if party.party_quest and party.party_quest.status == "active":
            party.party_quest.status = "abandoned"

        await self.session.commit()
        full_party = await self._get_party_with_members(party_id)
        members = self._format_members(full_party, user.id)
        return PartyResponse(
            id=full_party.id,
            name=full_party.name,
            status=full_party.status,
            host_id=full_party.host_id,
            created_at=full_party.created_at,
            members=members,
            has_active_quest=False,
            party_quest_id=None,
        )

    async def set_identity_reveal_consent(
        self,
        party_id: uuid.UUID,
        user: User,
        request: ConsentRevealRequest,
    ) -> PartyResponse:
        party = await self._get_party_with_members(party_id)
        active_members = [m for m in party.memberships if m.status == "active"]
        membership = next((m for m in active_members if m.user_id == user.id), None)
        if not membership:
            raise PartyAccessForbiddenError()

        membership.consent_reveal_identity = request.consent
        await self.session.commit()

        full_party = await self._get_party_with_members(party_id)
        members = self._format_members(full_party, user.id)
        return PartyResponse(
            id=full_party.id,
            name=full_party.name,
            status=full_party.status,
            host_id=full_party.host_id,
            created_at=full_party.created_at,
            members=members,
            has_active_quest=full_party.party_quest is not None,
            party_quest_id=full_party.party_quest.id if full_party.party_quest else None,
        )

    async def start_cooperative_quest(
        self,
        party_id: uuid.UUID,
        user: User,
        request: PartyStartQuestRequest,
    ) -> SharedPartyQuestResponse:
        party = await self._get_party_with_members(party_id, for_update=True)
        active_members = [m for m in party.memberships if m.status == "active"]
        my_membership = next((m for m in active_members if m.user_id == user.id), None)

        if not my_membership:
            raise PartyAccessForbiddenError()

        if len(active_members) != 2:
            raise PartyConflictError("Cooperative quests require exactly two explorers in the party.")

        if party.party_quest and party.party_quest.status == "active":
            raise PartyConflictError("Party already has an active cooperative quest.")

        # Generate single shared quest narrative from Google Places + Gemma or Demo
        quest_req = QuestCreateRequest(
            user_id=party.host_id,
            available_minutes=request.available_minutes,
            explorer_type=request.explorer_type,
            difficulty=request.difficulty,
            latitude=request.latitude,
            longitude=request.longitude,
        )
        generated = await self.provider.generate_quest(quest_req)

        # Create underlying Quest model
        quest = Quest(
            user_id=party.host_id,
            title=f"[Co-op] {generated.title}"[:150],
            description=generated.description,
            difficulty=generated.difficulty,
            estimated_minutes=generated.estimated_minutes,
            reward_xp=generated.reward_xp,
            status="active",
            destination_name=generated.destination_name,
            destination_latitude=generated.destination_latitude,
            destination_longitude=generated.destination_longitude,
            verification_prompt=generated.verification_prompt,
            verification_answer=generated.verification_answer,
            started_at=datetime.now(timezone.utc),
        )
        self.session.add(quest)
        await self.session.flush()

        # Create PartyQuest association
        party_quest = PartyQuest(
            party_id=party.id,
            quest_id=quest.id,
            status="active",
        )
        party.party_quest = party_quest
        party_quest.party = party
        party_quest.quest = quest
        self.session.add(party_quest)
        await self.session.flush()

        # Split Clues: Provide complementary clue subsets for each explorer
        # Explorer 1 gets odd clues + specific perspective, Explorer 2 gets even clues + specific perspective
        clues_p1 = [
            (1, "Compass Riddle (Perspective A)", generated.clues[0] if len(generated.clues) > 0 else "Seek the historical approach."),
            (2, "Architectural Marker (Perspective A)", generated.clues[2] if len(generated.clues) > 2 else "Observe structural carvings near the threshold."),
        ]
        clues_p2 = [
            (1, "Atmospheric Beacon (Perspective B)", generated.clues[1] if len(generated.clues) > 1 else "Follow the path where shadow meets stone."),
            (2, "Environmental Survey (Perspective B)", "Look for subtle boundary markings guiding travelers to the landmark focal point."),
        ]

        # First clue for each member is initially revealed
        for step_order, title, text_val in clues_p1:
            sc = SplitClue(
                party_quest_id=party_quest.id,
                assigned_slot=1,
                step_order=step_order,
                clue_title=title,
                clue_text=text_val,
                is_revealed=(step_order == 1),
                revealed_at=datetime.now(timezone.utc) if step_order == 1 else None,
            )
            self.session.add(sc)

        for step_order, title, text_val in clues_p2:
            sc = SplitClue(
                party_quest_id=party_quest.id,
                assigned_slot=2,
                step_order=step_order,
                clue_title=title,
                clue_text=text_val,
                is_revealed=(step_order == 1),
                revealed_at=datetime.now(timezone.utc) if step_order == 1 else None,
            )
            self.session.add(sc)

        # Initialize individual verifications
        for m in active_members:
            mv = MemberVerification(
                party_quest_id=party_quest.id,
                membership_id=m.id,
                user_id=m.user_id,
                verified=False,
            )
            self.session.add(mv)

        party.status = "active"
        party_id = party.id
        await self.session.commit()

        return await self.get_shared_quest_progress(party_id, user)

    async def get_shared_quest_progress(
        self,
        party_id: uuid.UUID,
        user: User,
    ) -> SharedPartyQuestResponse:
        party = await self._get_party_with_members(party_id)
        active_members = [m for m in party.memberships if m.status == "active"]
        my_membership = next((m for m in active_members if m.user_id == user.id), None)
        partner_membership = next((m for m in active_members if m.user_id != user.id), None)

        if not my_membership:
            raise PartyAccessForbiddenError()

        if not party.party_quest:
            raise PartyNotFoundError("No active quest in this party.")

        pq = party.party_quest
        quest = pq.quest
        is_completed = pq.status == "completed"

        # Verifications
        v_stmt = select(MemberVerification).where(MemberVerification.party_quest_id == pq.id)
        v_list = (await self.session.execute(v_stmt)).scalars().all()
        v_map = {v.user_id: v for v in v_list}

        my_ver = v_map.get(user.id)
        partner_ver = v_map.get(partner_membership.user_id) if partner_membership else None

        # Split clues: Filter so each explorer only sees their own assigned clues
        # Partner clues are only exposed as counts to preserve mystery separation!
        my_clues: list[SplitClueResponse] = []
        partner_total = 0
        partner_revealed = 0

        for sc in pq.split_clues:
            if sc.assigned_slot == my_membership.slot_number:
                my_clues.append(
                    SplitClueResponse(
                        id=sc.id,
                        step_order=sc.step_order,
                        clue_title=sc.clue_title,
                        clue_text=sc.clue_text if sc.is_revealed else "Assigned clue locked. Complete discovery step to reveal.",
                        is_revealed=sc.is_revealed,
                        is_assigned_to_me=True,
                    )
                )
            else:
                partner_total += 1
                if sc.is_revealed:
                    partner_revealed += 1

        my_clues.sort(key=lambda c: c.step_order)

        # Partner display name with mutual consent check
        both_consented = len(active_members) == 2 and all(m.consent_reveal_identity for m in active_members)
        partner_name = (
            (partner_membership.user.name if both_consented else partner_membership.nickname)
            if partner_membership
            else "Awaiting Partner"
        )

        return SharedPartyQuestResponse(
            party_id=party.id,
            party_quest_id=pq.id,
            quest_id=quest.id,
            title=quest.title,
            description=quest.description,
            difficulty=quest.difficulty,
            estimated_minutes=quest.estimated_minutes,
            reward_xp=quest.reward_xp,
            status=pq.status,
            my_slot=my_membership.slot_number,
            my_clues=my_clues,
            partner_clues_count=partner_total,
            partner_clues_revealed=partner_revealed,
            partner_display_name=partner_name,
            partner_verified=partner_ver.verified if partner_ver else False,
            my_verified=my_ver.verified if my_ver else False,
            verification_prompt=quest.verification_prompt,
            destination_name=quest.destination_name if is_completed else None,
            created_at=pq.created_at,
            completed_at=pq.completed_at,
        )

    async def unlock_assigned_clue(
        self,
        party_id: uuid.UUID,
        clue_id: uuid.UUID,
        user: User,
    ) -> SharedPartyQuestResponse:
        party = await self._get_party_with_members(party_id)
        active_members = [m for m in party.memberships if m.status == "active"]
        my_membership = next((m for m in active_members if m.user_id == user.id), None)
        if not my_membership:
            raise PartyAccessForbiddenError()

        if not party.party_quest or party.party_quest.status != "active":
            raise PartyConflictError("Cannot unlock clues: party quest is not active.")

        sc_stmt = (
            select(SplitClue)
            .where(
                SplitClue.id == clue_id,
                SplitClue.party_quest_id == party.party_quest.id,
                SplitClue.assigned_slot == my_membership.slot_number,
            )
        )
        clue = (await self.session.execute(sc_stmt)).scalars().first()
        if not clue:
            raise PartyNotFoundError("Clue not found or not assigned to your explorer slot.")

        clue.is_revealed = True
        clue.revealed_at = datetime.now(timezone.utc)
        await self.session.commit()

        return await self.get_shared_quest_progress(party_id, user)

    async def verify_individual_arrival(
        self,
        party_id: uuid.UUID,
        user: User,
        request: PartyVerifyRequest,
    ) -> PartyVerificationResponse:
        if not math.isfinite(request.latitude) or not math.isfinite(request.longitude):
            raise PartyServiceError("Coordinates must be valid finite numbers", status_code=422)

        # Atomic transaction
        if not self.session.in_transaction():
            await self.session.begin()

        party = await self._get_party_with_members(party_id, for_update=True)
        active_members = [m for m in party.memberships if m.status == "active"]
        my_membership = next((m for m in active_members if m.user_id == user.id), None)
        partner_membership = next((m for m in active_members if m.user_id != user.id), None)

        if not my_membership:
            raise PartyAccessForbiddenError()

        if not party.party_quest or party.party_quest.status != "active":
            raise PartyConflictError("Party does not have an active cooperative quest.")

        pq = party.party_quest
        quest = pq.quest

        # Proximity check server-side
        distance = calculate_haversine_distance_meters(
            request.latitude,
            request.longitude,
            float(quest.destination_latitude),
            float(quest.destination_longitude),
        )

        if distance > settings.verification_radius_meters:
            raise PartyServiceError("Verification failed: You are not within the target landmark area.", status_code=400)

        # Observation answer check
        if request.observation_answer.strip().lower() != quest.verification_answer.strip().lower():
            raise PartyServiceError("Verification failed: Observation answer did not match site ground truth.", status_code=400)

        # Lock member verifications
        v_stmt = (
            select(MemberVerification)
            .where(MemberVerification.party_quest_id == pq.id)
            .with_for_update()
        )
        verifications = (await self.session.execute(v_stmt)).scalars().all()
        v_map = {v.user_id: v for v in verifications}

        my_ver = v_map.get(user.id)
        if not my_ver:
            raise PartyServiceError("Verification record not found.", status_code=500)

        if my_ver.verified:
            raise PartyConflictError("You have already verified your arrival for this cooperative quest.")

        # Mark user verified
        now = datetime.now(timezone.utc)
        my_ver.verified = True
        my_ver.verified_at = now
        my_ver.distance_meters = round(distance, 2)
        my_ver.observation_answer_submitted = request.observation_answer.strip()

        # Check partner verified
        partner_ver = v_map.get(partner_membership.user_id) if partner_membership else None
        both_verified = partner_ver is not None and partner_ver.verified

        is_simulation = quest.destination_name.startswith("[Simulated Demo]")

        # XP rules: Award XP atomically. Only simulated quests award XP; real-world awards 0 XP until field ground truth verified.
        # Prevent duplicate grants:
        awarded_xp = 0
        if both_verified and is_simulation:
            awarded_xp = quest.reward_xp

        # Lock and update explorer profile
        prof_stmt = select(Profile).where(Profile.user_id == user.id).with_for_update()
        my_profile = (await self.session.execute(prof_stmt)).scalars().first()

        if not my_profile:
            raise PartyServiceError("Explorer profile not found.", status_code=404)

        if both_verified:
            pq.status = "completed"
            pq.completed_at = now
            quest.status = "completed"
            quest.completed_at = now
            party.status = "completed"

            # Award XP to both members
            if is_simulation and quest.reward_xp > 0:
                my_ver.reward_xp_awarded = quest.reward_xp
                my_profile.xp += quest.reward_xp
                my_profile.level = calculate_profile_level(my_profile.xp)

                if partner_membership:
                    partner_prof_stmt = select(Profile).where(Profile.user_id == partner_membership.user_id).with_for_update()
                    partner_profile = (await self.session.execute(partner_prof_stmt)).scalars().first()
                    if partner_profile and partner_ver:
                        partner_ver.reward_xp_awarded = quest.reward_xp
                        partner_profile.xp += quest.reward_xp
                        partner_profile.level = calculate_profile_level(partner_profile.xp)

        await self.session.commit()

        msg = (
            "Cooperative quest accomplished! Both partners verified."
            if both_verified
            else "Your arrival is confirmed! Waiting for your mystery partner to reach the landmark and verify."
        )

        return PartyVerificationResponse(
            success=True,
            message=msg,
            my_verified=True,
            partner_verified=both_verified,
            quest_completed=both_verified,
            reward_xp_awarded=awarded_xp if both_verified else 0,
            total_xp=my_profile.xp,
            level=my_profile.level,
            destination_name=quest.destination_name if both_verified else None,
        )
