import django.db.models.deletion
from django.db import migrations, models


def copy_property(apps, schema_editor):
    Receipt = apps.get_model("billing", "Receipt")
    for receipt in Receipt.objects.select_related("payment__entry__tenancy").only(
        "payment__entry__tenancy__property_id"
    ):
        Receipt.objects.filter(pk=receipt.pk).update(
            property_id=receipt.payment.entry.tenancy.property_id
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
    ]
