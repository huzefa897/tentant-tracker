from django.db import migrations, models

# A receipt says which of its readings were worked out from units reported rather than read off
# the meter (MeterReading.entered_units), since those may not match the dial. Every receipt
# before this was issued from readings typed off the meter, so False is right for them.


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0017_meter_reading_entered_units"),
    ]

    operations = [
        migrations.AddField(
            model_name="receipt",
            name="opening_from_units",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="receipt",
            name="closing_from_units",
            field=models.BooleanField(default=False),
        ),
        migrations.AddConstraint(
            model_name="receipt",
            constraint=models.CheckConstraint(
                condition=models.Q(electricity_mode="meter")
                | models.Q(opening_from_units=False, closing_from_units=False),
                name="receipt_from_units_with_meter_mode",
            ),
        ),
    ]
