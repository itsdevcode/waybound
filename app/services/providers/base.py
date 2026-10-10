from typing import Protocol, runtime_checkable

from app.schemas.quest import DestinationCandidate, QuestCreateRequest


class QuestGenerationResult:
    def __init__(
        self,
        title: str,
        description: str,
        difficulty: str,
        estimated_minutes: int,
        reward_xp: int,
        destination_name: str,
        destination_latitude: float,
        destination_longitude: float,
        verification_prompt: str,
        verification_answer: str,
        clues: list[str],
    ) -> None:
        self.title = title
        self.description = description
        self.difficulty = difficulty
        self.estimated_minutes = estimated_minutes
        self.reward_xp = reward_xp
        self.destination_name = destination_name
        self.destination_latitude = destination_latitude
        self.destination_longitude = destination_longitude
        self.verification_prompt = verification_prompt
        self.verification_answer = verification_answer
        self.clues = clues


@runtime_checkable
class QuestProvider(Protocol):
    """
    Protocol defining quest content generation.
    Phase 2 can implement this protocol with Gemma without rewriting the Quest Engine.
    """

    async def generate_quest(
        self,
        request: QuestCreateRequest,
    ) -> QuestGenerationResult:
        ...
