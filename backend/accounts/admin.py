from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class AppUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        (
            "Firebase identity",
            {
                "fields": (
                    "firebase_uid",
                    "phone_number",
                ),
            },
        ),
    )

    list_display = (
        "username",
        "email",
        "phone_number",
        "is_staff",
        "is_active",
    )

    search_fields = (
        "username",
        "email",
        "phone_number",
        "firebase_uid",
    )
