# Fastisan Dogfooding Improvements & Feedback

This document records verified shortcomings and enhancement opportunities discovered while dogfooding **Fastisan 0.1.0** during the implementation of Phase 1 of WAYBOUND.

---

### Finding 1: `make:model` generates integer primary keys instead of configurable UUID primary keys

- **Generated component:** `fastisan make:model <Name>` (`app/models/<name>.py`)
- **Observed problem:**
  When executing `fastisan make:model Quest`, the generator produced:
  ```python
  class Quest(Base):
      __tablename__ = "quests"
      id: Mapped[int] = mapped_column(Integer, primary_key=True)
  ```
  It lacks options to specify primary key types (e.g., UUID vs BigInteger vs Integer). Because modern distributed applications and existing models in the repository (e.g., `User`, `Profile`) use `uuid.UUID` (`UUID(as_uuid=True)`), manual refactoring is required every time.
- **Why it matters:**
  Developers using Postgres or distributed UUID PKs have to manually delete and replace the primary key definition, defeating part of the scaffold generator's productivity value.
- **Proposed improvement:**
  Add a `--pk` or `--id-type` flag:
  ```bash
  fastisan make:model Quest --pk uuid
  ```
  Or allow a default primary key strategy configured in `fastisan.toml` (e.g., `[project.models] primary_key = "uuid"`).
- **Priority:** High

---

### Finding 2: `make:model` generates timezone-unaware `DateTime` columns

- **Generated component:** `fastisan make:model <Name>` (`app/models/<name>.py`)
- **Observed problem:**
  Generated models contain:
  ```python
  created_at: Mapped[datetime] = mapped_column(
      DateTime, server_default=func.now()
  )
  updated_at: Mapped[datetime] = mapped_column(
      DateTime, server_default=func.now(), onupdate=func.now()
  )
  ```
  SQLAlchemy `DateTime` without `timezone=True` generates `TIMESTAMP WITHOUT TIME ZONE` in PostgreSQL, creating inconsistencies with timezone-aware datetime applications and existing models in the project.
- **Why it matters:**
  Timezone-naive timestamps cause subtle bugs in audit logs, quest expiration calculations, and distributed systems.
- **Proposed improvement:**
  Use `DateTime(timezone=True)` by default for PostgreSQL configurations in `fastisan.toml`, or allow a global setting `timezone_aware = true`.
- **Priority:** Medium

---

### Finding 3: `make:schema` generates empty placeholder classes with integer IDs

- **Generated component:** `fastisan make:schema <Name>` (`app/schemas/<name>.py`)
- **Observed problem:**
  Running `fastisan make:schema Quest` generates:
  ```python
  class QuestResponse(QuestBase):
      id: int
      created_at: datetime
      updated_at: datetime
  ```
  `id` is hardcoded to `int`, and request/response separation is rigid without support for UUIDs or nested models.
- **Why it matters:**
  If the model uses UUIDs, the schema fails validation when dumping model attributes, requiring repetitive manual edits.
- **Proposed improvement:**
  Support `--pk uuid` or introspect existing model definitions when a model with the same name exists in `app/models/`.
- **Priority:** Medium

---

### Finding 4: `make:repository` and `make:service` hardcode `id: int`

- **Generated component:** `fastisan make:repository <Name>` and `fastisan make:service <Name>`
- **Observed problem:**
  Generated repository methods have type signatures:
  ```python
  async def detail(self, id: int) -> Quest | None:
  ```
  and service methods have:
  ```python
  async def detail(self, id: int) -> QuestResponse | None:
  async def delete(self, id: int) -> bool:
  ```
- **Why it matters:**
  Calling `detail(quest_id)` with a `uuid.UUID` triggers Pyright/Mypy type errors.
- **Proposed improvement:**
  Allow typing options (e.g., `--pk-type uuid.UUID` or generic `TId = Any`), or align with `fastisan.toml`.
- **Priority:** High

---

### Finding 5: `make:router` does not support API versioning prefixing (e.g. `/api/v1`)

- **Generated component:** `fastisan make:router <Name>` and `app/routers/registry.py`
- **Observed problem:**
  When generating routers, Fastisan creates `prefix="/quest"` and mounts directly into `app/routers/registry.py` without an API versioning namespace (such as `/api/v1`).
- **Why it matters:**
  Most production FastAPI applications version their APIs. Having to rewrite the router registry prefixes manually creates drift between CLI-generated routes and production architecture.
- **Proposed improvement:**
  Allow a prefix configuration in `fastisan.toml`:
  ```toml
  [api]
  prefix = "/api/v1"
  ```
- **Priority:** Low
