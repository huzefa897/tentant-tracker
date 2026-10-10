import django.db.models.deletion
from django.db import migrations, models
from django.db.migrations.exceptions import IrreversibleError
from django.db.models import Count


def copy_property(apps, schema_editor):
    Receipt = apps.get_model("billing", "Receipt")
    for receipt in Receipt.objects.select_related("payment__entry__tenancy").only(
        "payment__entry__tenancy__property_id"
    ):
        Receipt.objects.filter(pk=receipt.pk).update(
            property_id=receipt.payment.entry.tenancy.property_id
        )


def refuse_shared_references(apps, schema_editor):
    # Undoing this makes references unique across every property again. Two properties may
    # now share one, and renumbering would change references already printed on tenants'
    # receipts, so the rollback stops instead and says which references clash.
    Receipt = apps.get_model("billing", "Receipt")
    shared = list(
        Receipt.objects.values("reference")
        .annotate(count=Count("id"))
        .filter(count__gt=1)
        .order_by("reference")
        .values_list("reference", flat=True)
    )
    if shared:
        raise IrreversibleError(
            "Can't undo billing.0006: these receipt references are used by more than one "
            "property, and before it references were unique across every property: "
            + ", ".join(shared)
        )


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0005_payment_sequence"),
        ("properties", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="receipt",
            name="property",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="receipts",
                to="properties.property",
            ),
        ),
        migrations.RunPython(copy_property, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="receipt",
            name="property",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="receipts",
                to="properties.property",
            ),
        ),
        migrations.AlterField(
            model_name="receipt",
            name="reference",
            field=models.CharField(editable=False, max_length=255),
        ),
        migrations.AddConstraint(
            model_name="receipt",
            constraint=models.UniqueConstraint(
                fields=("property", "reference"), name="unique_receipt_reference_per_property"
            ),
        ),
        # Last, so on the way back it runs first, before references are unique again.
        migrations.RunPython(migrations.RunPython.noop, refuse_shared_references),
    ]
