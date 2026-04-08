from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from shared.config import Settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine(settings: Settings | None = None) -> AsyncEngine:
    global _engine
    if _engine is None:
        s = settings or Settings()
        _engine = create_async_engine(s.database_url, echo=False, pool_size=5)
    return _engine


def get_session_factory(settings: Settings | None = None) -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        engine = get_engine(settings)
        _session_factory = async_sessionmaker(engine, expire_on_commit=False)
    return _session_factory
