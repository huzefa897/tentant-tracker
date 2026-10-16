"""Keeps rental periods' due dates when the settings they come from change (periods.py)."""

from django.db.models.signals import pre_save
from django.dispatch import receiver

from properties.models import Property, Tenancy

from .periods import freeze_before_change


@receiver(pre_save, sender=Tenancy, dispatch_uid="billing_freeze_tenancy_periods")
def freeze_tenancy_periods(sender, instance: Tenancy, raw=False, **kwargs):
    if raw or instance._state.adding:
        return
    stored = Tenancy.objects.select_related("property").filter(pk=instance.pk).first()
    if stored is not None and stored.rent_due_day != instance.rent_due_day:
        freeze_before_change(tenancy=stored)


@receiver(pre_save, sender=Property, dispatch_uid="billing_freeze_property_periods")
def freeze_property_periods(sender, instance: Property, raw=False, **kwargs):
    if raw or instance._state.adding:
        return
    stored = Property.objects.filter(pk=instance.pk).first()
    if stored is not None and stored.payment_timing != instance.payment_timing:
        freeze_before_change(prop=stored)
