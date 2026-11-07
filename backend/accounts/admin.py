import uuid

from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserChangeForm
from django.contrib import messages
from django.contrib.auth.models import Group
from django.db.models import Prefetch
from django.http import HttpResponseRedirect

from properties.admin import GrantedByMixin, MembershipInlineBase
from properties.models import PropertyMembership

from .firebase import FirebaseUnavailableError
from .models import User
from .services import unlink_if_email_changed

# Django's groups grant admin-portal permissions across every property, so they can't
# express property roles (those live on PropertyMembership). Hidden until back-office
# staff need them.
admin.site.unregister(Group)

UNAVAILABLE_MESSAGE = "Couldn't reach Firebase to sign this person out. Nothing was saved; try again."


class FirebaseSyncError(Exception):
    """Firebase failed while saving; raised to roll the admin's transaction back."""


class PersonChangeForm(UserChangeForm):
    class Meta(UserChangeForm.Meta):
        model = User


class PersonCreationForm(forms.ModelForm):
    """Adds an app user: their Google email is what lets them sign in. They get an
    internal username and no password (admin access is granted separately)."""

    class Meta:
        model = User
        fields = ("name", "email", "phone_number")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["email"].required = True
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
        return (
            ("yes", "Can sign in"),
            ("waiting", "Not signed in yet"),
            ("no", "Can't sign in"),
        )

    def queryset(self, request, queryset):
        if self.value() == "yes":
            return queryset.exclude(email="")
        if self.value() == "waiting":
            return queryset.exclude(email="").filter(firebase_uid__isnull=True)
        if self.value() == "no":
            return queryset.filter(email="")
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
        "linked_to_google",
        "property_access",
        "is_staff",
        "is_active",
        "last_login",
    )
    list_display_links = ("display_name",)
    list_filter = (AppSignInFilter, PropertyAccessFilter, "is_staff", "is_active")
    search_fields = ("name", "phone_number", "email", "username", "firebase_uid")
    ordering = ("name", "email", "username")
    readonly_fields = ("firebase_uid", "last_login", "date_joined")

    fieldsets = (
        ("Profile", {"fields": ("name", "email", "phone_number")}),
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
                "description": "Signing in here uses a username and password, never Google.",
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
                "fields": ("name", "email", "phone_number"),
                "description": (
                    "Only Google emails added here can sign in to the app; their first "
                    "sign-in links the Google account. "
                    "After saving, give them access to a property below."
                ),
            },
        ),
    )

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        try:
            return super().changeform_view(request, object_id, form_url, extra_context)
        except FirebaseSyncError as error:
            # The transaction has rolled back: nothing about this person changed.
            self.message_user(request, str(error), messages.ERROR)
            return HttpResponseRedirect(request.get_full_path())

    def save_related(self, request, form, formsets, change):
        """Changes Firebase last, after the person and their property access have
        validated and been written, inside the admin's transaction. A Firebase failure
        rolls everything back."""
        super().save_related(request, form, formsets, change)

        user = form.instance
        linked_uid = user.firebase_uid
        try:
            unlink_if_email_changed(user, form.initial.get("email") or "")
        except FirebaseUnavailableError:
            raise FirebaseSyncError(UNAVAILABLE_MESSAGE) from None

        if user.firebase_uid != linked_uid:
            user.save(update_fields=["firebase_uid"])

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
        return bool(obj.email)

    @admin.display(description="Signed in with Google", boolean=True)
    def linked_to_google(self, obj):
        return bool(obj.email and obj.firebase_uid)

    @admin.display(description="Properties")
    def property_access(self, obj):
        memberships = getattr(obj, "active_memberships", None)
        if memberships is None:
            memberships = obj.property_memberships.filter(is_active=True, property__is_active=True)
        return ", ".join(f"{m.property} ({m.get_role_display()})" for m in memberships) or "—"
