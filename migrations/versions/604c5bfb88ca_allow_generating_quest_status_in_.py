"""allow generating_quest status in parties check constraint

Revision ID: 604c5bfb88ca
Revises: d7d7fb84a256
Create Date: 2026-10-11 02:58:08.000000

"""
from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '604c5bfb88ca'
down_revision: str | None = 'd7d7fb84a256'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint('ck_parties_status_valid', 'parties', type_='check')
    op.create_check_constraint(
        'ck_parties_status_valid',
        'parties',
        "status IN ('open', 'active', 'completed', 'disbanded', 'generating_quest')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_parties_status_valid', 'parties', type_='check')
    op.create_check_constraint(
        'ck_parties_status_valid',
        'parties',
        "status IN ('open', 'active', 'completed', 'disbanded')",
    )
