"""Keeps rental periods' due dates when the settings they come from change (periods.py): a save
(pre_save) or a QuerySet.update() / bulk_update() (schedule_will_change) of a tenancy's due day
or a property's payment timing first creates the periods due under the stored setting."""

from django.db.models.signals import pre_save
from django.dispatch import receiver

from properties.models import Property, Tenancy, schedule_will_change

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


# Every row the update matches, changed or not: freezing creates only periods already due, as
# the dashboard would.
@receiver(schedule_will_change, sender=Tenancy, dispatch_uid="billing_freeze_updated_tenancies")
def freeze_updated_tenancies(sender, stored, **kwargs):
    for tenancy in stored.select_related("property"):
        freeze_before_change(tenancy=tenancy)


@receiver(schedule_will_change, sender=Property, dispatch_uid="billing_freeze_updated_properties")
def freeze_updated_properties(sender, stored, **kwargs):
    for prop in stored:
        freeze_before_change(prop=prop)
