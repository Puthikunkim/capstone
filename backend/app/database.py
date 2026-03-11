# - Database connection setup using SQLAlchemy.
# - Creates the SQLite engine
# - Defines the declarative Base class used by all ORM models.
# - Provides a dependency generator for using db that yields a scoped session
#   per request and ensures it is closed when the request finishes.
