import uuid

from django.conf import settings
from django.db import models


class Property(models.Model):
    """A building. Receipts will snapshot these details when issued."""

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    name = models.CharField(max_length=150)
    address = models.TextField()
    contact_number = models.CharField(
        max_length=20,
        blank=True,
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "properties"

    def __str__(self):
        return self.name


class PropertyMembership(models.Model):
    """A person's role at a property: the only thing that grants property access.
    What each role may do is in properties/roles.py."""

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        MANAGER = "manager", "Manager"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="property_memberships",
    )
    property = models.ForeignKey(
        Property,
        on_delete=models.PROTECT,
        related_name="memberships",
    )
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Inactive memberships keep their history but grant no access.",
    )
    # Who gave this access, for auditing. Kept if that person is later removed.
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        editable=False,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "property"],
                name="unique_user_property_membership",
            ),
        ]

    def __str__(self):
        return f"{self.user} | {self.property} | {self.get_role_display()}"
