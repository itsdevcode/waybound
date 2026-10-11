"""add waypoint columns to quest_steps

Revision ID: b39c7e12f041
Revises: f8466515b7e0
Create Date: 2026-10-11 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b39c7e12f041'
down_revision: Union[str, None] = 'f8466515b7e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('quest_steps', sa.Column('waypoint_place_id', sa.String(length=255), nullable=True))
    op.add_column('quest_steps', sa.Column('waypoint_name', sa.String(length=255), nullable=True))
    op.add_column('quest_steps', sa.Column('waypoint_latitude', sa.Numeric(precision=9, scale=6), nullable=True))
    op.add_column('quest_steps', sa.Column('waypoint_longitude', sa.Numeric(precision=9, scale=6), nullable=True))


def downgrade() -> None:
    op.drop_column('quest_steps', 'waypoint_longitude')
    op.drop_column('quest_steps', 'waypoint_latitude')
    op.drop_column('quest_steps', 'waypoint_name')
    op.drop_column('quest_steps', 'waypoint_place_id')
