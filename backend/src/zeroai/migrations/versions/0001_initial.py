"""Create the initial application tables."""

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()

    sa.Table(
        "newssource",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("url_template", sa.String(length=500), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
    ).create(bind, checkfirst=True)

    sa.Table(
        "llmconfig",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("base_url", sa.String(), nullable=True),
        sa.Column("api_key", sa.String(), nullable=True),
    ).create(bind, checkfirst=True)

    usage_record = sa.Table(
        "usagerecord",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("requests", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
    )
    usage_record.create(bind, checkfirst=True)
    for column in ("created_at", "provider", "model"):
        sa.Index(f"ix_usagerecord_{column}", usage_record.c[column]).create(bind, checkfirst=True)


def downgrade() -> None:
    for name in (
        "ix_usagerecord_model",
        "ix_usagerecord_provider",
        "ix_usagerecord_created_at",
    ):
        op.drop_index(name, table_name="usagerecord", if_exists=True)
    for name in ("usagerecord", "llmconfig", "newssource"):
        op.drop_table(name, if_exists=True)
