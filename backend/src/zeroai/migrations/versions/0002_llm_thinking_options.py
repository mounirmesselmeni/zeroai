"""Add model reasoning preferences."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0002_llm_thinking_options"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("llmconfig")}
    if "thinking" not in columns:
        op.add_column(
            "llmconfig",
            sa.Column("thinking", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        )
    if "thinking_effort" not in columns:
        op.add_column(
            "llmconfig",
            sa.Column(
                "thinking_effort", sa.String(), nullable=False, server_default=sa.text("'high'")
            ),
        )


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("llmconfig")}
    if "thinking_effort" in columns:
        op.drop_column("llmconfig", "thinking_effort")
    if "thinking" in columns:
        op.drop_column("llmconfig", "thinking")
