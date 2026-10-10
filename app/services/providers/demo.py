from app.schemas.quest import DestinationCandidate, QuestCreateRequest
from app.services.providers.base import QuestGenerationResult, QuestProvider


# Simulated Demo Destinations
# IMPORTANT NOTICE: All destinations, clues, and observation answers in Phase 1
# are strictly SIMULATED, fictional demo scenarios for development and automated testing.
# They are NOT verified safe, field-verified, accessible, or actual real-world outdoor challenges.
# Simulated quest completion MUST NOT be misrepresented as actual outdoor exploration.
DEFAULT_DEMO_DESTINATIONS: list[DestinationCandidate] = [
    DestinationCandidate(
        name="[Simulated Demo] Central Library Courtyard",
        latitude=37.779260,
        longitude=-122.416040,
        description="A simulated urban library courtyard used solely for development and algorithmic verification testing.",
        explorer_types=["discovery", "mystery"],
        difficulties=["easy", "medium"],
        suitable_minutes=[15, 30],
        verification_prompt="[Simulated Challenge] What mythical creature is sculpted atop the simulated courtyard sundial stone?",
        verification_answer="owl",
        clues=[
            "[Simulated Clue] Seek where quiet knowledge resides and shadows stretch across marble benches.",
            "[Simulated Clue] Look toward the center stone circle where time was once measured by the sun.",
            "[Simulated Clue] Inspect the top of the bronze sundial fixture for an avian symbol of wisdom.",
        ],
    ),
    DestinationCandidate(
        name="[Simulated Demo] Old Harbor Maritime Compass Rose",
        latitude=37.808600,
        longitude=-122.409820,
        description="A simulated maritime pier scenario used solely for development and algorithmic verification testing.",
        explorer_types=["nature", "discovery", "fitness"],
        difficulties=["easy", "medium", "hard"],
        suitable_minutes=[30, 60],
        verification_prompt="[Simulated Challenge] What year is stamped into the simulated maritime marker overlook?",
        verification_answer="1934",
        clues=[
            "[Simulated Clue] Head toward the salty breeze and the wooden boardwalk where gulls gather.",
            "[Simulated Clue] Find the circular inlaid compass rose on the observation deck facing north.",
            "[Simulated Clue] Read the four-digit founding year engraved at the southern point of the compass.",
        ],
    ),
    DestinationCandidate(
        name="[Simulated Demo] Vista Hilltop Pavilion",
        latitude=37.769420,
        longitude=-122.446747,
        description="A simulated panoramic hilltop trail clearing used solely for development and algorithmic verification testing.",
        explorer_types=["nature", "fitness"],
        difficulties=["medium", "hard"],
        suitable_minutes=[30, 60],
        verification_prompt="[Simulated Challenge] What color is the simulated wooden dedication bench facing the west trail?",
        verification_answer="green",
        clues=[
            "[Simulated Clue] Ascend the winding path until the cityscape unfolds beneath the tree line.",
            "[Simulated Clue] Approach the stone pavilion where the trail branches into two directions.",
            "[Simulated Clue] Locate the weathered wooden memorial bench resting under the cypress tree.",
        ],
    ),
    DestinationCandidate(
        name="[Simulated Demo] Community Mosaic Garden Plaza",
        latitude=37.760120,
        longitude=-122.419130,
        description="A simulated neighborhood gathering square used solely for development and algorithmic verification testing.",
        explorer_types=["social", "discovery"],
        difficulties=["easy", "medium"],
        suitable_minutes=[15, 30],
        verification_prompt="[Simulated Challenge] What tile animal is depicted on the simulated water fountain base?",
        verification_answer="turtle",
        clues=[
            "[Simulated Clue] Wander toward the lively plaza alive with murals and neighborhood voices.",
            "[Simulated Clue] Approach the low circular mosaic fountain in the gathering square.",
            "[Simulated Clue] Examine the mosaic tiles around the lower rim for an aquatic reptile.",
        ],
    ),
]


# XP calculation based on difficulty and time
DIFFICULTY_XP_MULTIPLIER = {
    "easy": 100,
    "medium": 200,
    "hard": 350,
}

DURATION_XP_BONUS = {
    15: 50,
    30: 100,
    60: 200,
}


class DemoQuestProvider(QuestProvider):
    """
    Deterministic demo provider generating explicitly simulated demo quests.
    Phase 1 does not depend on external AI services and must never misrepresent
    simulated coordinates or answers as real-world verified destinations.
    """

    def __init__(self, destinations: list[DestinationCandidate] | None = None) -> None:
        self.destinations = destinations if destinations is not None else DEFAULT_DEMO_DESTINATIONS

    async def generate_quest(
        self,
        request: QuestCreateRequest,
    ) -> QuestGenerationResult:
        if not self.destinations:
            raise ValueError(
                "No validated demo destinations configured. "
                "Configure simulated demo destination candidates before generating quests."
            )

        # Filter by explorer type, duration, or difficulty match
        matched: list[DestinationCandidate] = [
            d
            for d in self.destinations
            if request.explorer_type in d.explorer_types
            and request.difficulty in d.difficulties
            and request.available_minutes in d.suitable_minutes
        ]

        # Relax to explorer type or difficulty if exact match isn't available
        if not matched:
            matched = [
                d
                for d in self.destinations
                if request.explorer_type in d.explorer_types
                or request.difficulty in d.difficulties
            ]

        # Fallback to any configured destination if still none
        if not matched:
            matched = self.destinations

        # Deterministic selection based on user_id hash and parameters
        user_hash = sum(request.user_id.bytes)
        selected_index = (
            user_hash + request.available_minutes + len(request.explorer_type)
        ) % len(matched)
        destination = matched[selected_index]

        base_xp = DIFFICULTY_XP_MULTIPLIER.get(request.difficulty, 100)
        time_xp = DURATION_XP_BONUS.get(request.available_minutes, 50)
        total_reward_xp = base_xp + time_xp

        title = f"[Simulated Demo] The {request.explorer_type.capitalize()} of {destination.name.replace('[Simulated Demo] ', '')}"
        description = (
            f"[Simulated Quest - Not Real-World Field Verified] "
            f"A {request.difficulty}-difficulty {request.explorer_type} excursion "
            f"designed for an estimated {request.available_minutes} minutes. "
            f"{destination.description}"
        )

        return QuestGenerationResult(
            title=title[:150],
            description=description,
            difficulty=request.difficulty,
            estimated_minutes=request.available_minutes,
            reward_xp=total_reward_xp,
            destination_name=destination.name,
            destination_latitude=destination.latitude,
            destination_longitude=destination.longitude,
            verification_prompt=destination.verification_prompt,
            verification_answer=destination.verification_answer,
            clues=list(destination.clues),
        )
