from django.db import migrations, models


def number_existing_payments(apps, schema_editor):
    # Each bill's payments in the order they were recorded, as best that can be told now.
    Payment = apps.get_model("billing", "Payment")
    entry_id, sequence = None, 0
    for payment in Payment.objects.order_by("entry_id", "created_at", "id").only("entry_id"):
        if payment.entry_id != entry_id:
            entry_id, sequence = payment.entry_id, 0
        sequence += 1
        Payment.objects.filter(pk=payment.pk).update(sequence=sequence)


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0004_receipt_reference_from_tenant"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="sequence",
            field=models.PositiveIntegerField(editable=False, null=True),
        ),
        migrations.RunPython(number_existing_payments, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="payment",
            name="sequence",
            field=models.PositiveIntegerField(editable=False),
        ),
        migrations.AlterModelOptions(
            name="payment",
            options={"ordering": ("-paid_date", "-sequence", "id")},
        ),
        migrations.AddConstraint(
            model_name="payment",
            constraint=models.UniqueConstraint(
                fields=("entry", "sequence"), name="unique_payment_sequence_per_entry"
            ),
        ),
        migrations.AddConstraint(
            model_name="payment",
            constraint=models.CheckConstraint(
                condition=models.Q(sequence__gte=1), name="payment_sequence_positive"
            ),
        ),
    ]
