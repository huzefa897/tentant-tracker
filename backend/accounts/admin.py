import uuid

from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserChangeForm
from django.contrib.auth.models import Group
from django.db.models import Prefetch

from properties.admin import GrantedByMixin, MembershipInlineBase
from properties.models import PropertyMembership

from .firebase import FirebaseUnavailableError
from .models import User
from .services import PhoneNumberInUseError, link_firebase_identity

# Django's groups grant admin-portal permissions across every property, so they can't
# express property roles (those live on PropertyMembership). Hidden until back-office
# staff need them.
admin.site.unregister(Group)

IN_USE_MESSAGE = "This number's app sign-in already belongs to another person."
UNAVAILABLE_MESSAGE = "Couldn't reach Firebase to set up app sign-in. Nothing was saved; try again."


class FirebaseLinkMixin:
    """Links the person's app sign-in to their mobile number once the form is valid,
    before anything is saved, and reports problems on the number field."""

    def _post_clean(self):
        super()._post_clean()
        if self.errors:
            return
        try:
            link_firebase_identity(self.instance, self.initial.get("phone_number") or "")
        except PhoneNumberInUseError:
            self.add_error("phone_number", IN_USE_MESSAGE)
        except FirebaseUnavailableError:
            self.add_error("phone_number", UNAVAILABLE_MESSAGE)


class PersonChangeForm(FirebaseLinkMixin, UserChangeForm):
    class Meta(UserChangeForm.Meta):
        model = User


class PersonCreationForm(FirebaseLinkMixin, forms.ModelForm):
    """Adds an app user: the mobile number is what lets them sign in. They get an
    internal username and no password (admin access is granted separately)."""

    class Meta:
        model = User
        fields = ("name", "phone_number", "email")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["phone_number"].required = True
        self.instance.username = f"app-{uuid.uuid4().hex}"

    def save(self, commit=True):
        user = super().save(commit=False)
        user.set_unusable_password()
        if commit:
            user.save()
        return user


class PropertyAccessInline(MembershipInlineBase):
    """On a person: which properties they can access."""

    fk_name = "user"
    fields = ("property", "role", "is_active", "granted_by", "created_at")
    autocomplete_fields = ("property",)


class AppSignInFilter(admin.SimpleListFilter):
    title = "app sign-in"
    parameter_name = "app_sign_in"

    def lookups(self, request, model_admin):
        return (("yes", "Can sign in"), ("no", "Can't sign in"))

    def queryset(self, request, queryset):
        if self.value() == "yes":
            return queryset.filter(firebase_uid__isnull=False).exclude(phone_number="")
        if self.value() == "no":
            return queryset.exclude(firebase_uid__isnull=False, phone_number__gt="")
        return queryset


class PropertyAccessFilter(admin.SimpleListFilter):
    title = "property access"
    parameter_name = "property_access"

    def lookups(self, request, model_admin):
        return (("yes", "Has property access"), ("no", "Waiting for access"))

    def queryset(self, request, queryset):
        active = {
            "property_memberships__is_active": True,
            "property_memberships__property__is_active": True,
        }
        if self.value() == "yes":
            return queryset.filter(**active).distinct()
        if self.value() == "no":
            return queryset.exclude(pk__in=User.objects.filter(**active).values("pk"))
        return queryset


@admin.register(User)
class PersonAdmin(GrantedByMixin, UserAdmin):
    form = PersonChangeForm
    add_form = PersonCreationForm

    list_display = (
        "display_name",
        "can_sign_in",
        "property_access",
        "is_staff",
        "is_active",
        "last_login",
    )
    list_display_links = ("display_name",)
    list_filter = (AppSignInFilter, PropertyAccessFilter, "is_staff", "is_active")
    search_fields = ("name", "phone_number", "email", "username", "firebase_uid")
    ordering = ("name", "phone_number", "username")
    readonly_fields = ("firebase_uid", "last_login", "date_joined")

    fieldsets = (
        ("Profile", {"fields": ("name", "phone_number", "email")}),
        (
            "Status",
            {
                "fields": ("is_active",),
                "description": "Inactive people can't sign in to the app or the admin portal.",
            },
        ),
        (
            "Admin portal access",
            {
                "classes": ("collapse",),
                "fields": ("is_staff", "is_superuser", "password"),
                "description": "Signing in here uses a username and password, never the phone.",
            },
        ),
        (
            "Technical",
            {
                "classes": ("collapse",),
                "fields": ("username", "firebase_uid", "last_login", "date_joined"),
            },
        ),
    )
    add_fieldsets = (
        (
            None,
            {
                "fields": ("name", "phone_number", "email"),
                "description": (
                    "Only numbers added here can sign in to the app. "
                    "After saving, give them access to a property below."
                ),
            },
        ),
    )

    def get_inlines(self, request, obj):
        return (PropertyAccessInline,) if obj else ()

    def get_queryset(self, request):
        active = PropertyMembership.objects.filter(
            is_active=True, property__is_active=True
        ).select_related("property")
        return (
            super()
            .get_queryset(request)
            .prefetch_related(Prefetch("property_memberships", active, to_attr="active_memberships"))
        )

    @admin.display(description="Person", ordering="name")
    def display_name(self, obj):
        return obj.display_name

    @admin.display(description="App sign-in", boolean=True)
    def can_sign_in(self, obj):
        return bool(obj.firebase_uid and obj.phone_number)

    @admin.display(description="Properties")
    def property_access(self, obj):
        memberships = getattr(obj, "active_memberships", None)
        if memberships is None:
            memberships = obj.property_memberships.filter(is_active=True, property__is_active=True)
        return ", ".join(f"{m.property} ({m.get_role_display()})" for m in memberships) or "—"
