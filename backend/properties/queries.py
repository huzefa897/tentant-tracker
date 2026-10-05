from django.db.models import F, QuerySet

from .models import Property


def properties_for_user(user) -> QuerySet[Property]:
    """Active properties the user has an active membership of, with their `role`.

    The single source of property access: list, detail and /me all use it, so an
    unassigned property is never listed and 404s on lookup.
    """
    return (
        Property.objects.filter(
            is_active=True,
            memberships__user=user,
            memberships__is_active=True,
        )
        # Same filter() call, so this is the matched membership's role.
        .annotate(role=F("memberships__role"))
        .distinct()
        .order_by("name")
    )
