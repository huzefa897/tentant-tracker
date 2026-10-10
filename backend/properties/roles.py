"""What each membership role may do. Permissions come from the role, not from flags on
each membership, so they're easy to explain, audit and change for everyone at once.

Every role can read its property (that's what an active membership means). Endpoints
that change data check a capability here; they arrive with BE Phase 3.
"""

from enum import StrEnum

from .models import PropertyMembership


class Capability(StrEnum):
    MANAGE_PROPERTY = "manage_property"  # name, address, contact details
    MANAGE_MEMBERS = "manage_members"  # grant, change and end memberships
    MANAGE_TENANTS = "manage_tenants"
    RECORD_PAYMENTS = "record_payments"  # rent entries and payments
    ISSUE_RECEIPTS = "issue_receipts"
    REVERSE_PAYMENTS = "reverse_payments"  # correct a payment recorded by mistake
    CORRECT_BILLS = "correct_bills"  # void a bill, or void it and create its replacement


Role = PropertyMembership.Role

ROLE_CAPABILITIES: dict[str, frozenset[Capability]] = {
    Role.OWNER: frozenset(Capability),
    # Managers record payments but can't reverse them or void bills: corrections are the
    # owners'.
    Role.MANAGER: frozenset(
        {
            Capability.MANAGE_TENANTS,
            Capability.RECORD_PAYMENTS,
            Capability.ISSUE_RECEIPTS,
        }
    ),
}


def role_can(role: str, capability: Capability) -> bool:
    """False for unknown roles, so a typo never grants access."""
    return capability in ROLE_CAPABILITIES.get(role, frozenset())
