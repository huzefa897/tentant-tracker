from django.db import migrations, models

# A reading entered as the units used since the latest reading keeps those units, so the
# history shows how it was entered. Like the rest of what was read, they're never edited: the
# guard trigger (0014) gets entered_units in its list of columns an UPDATE can't change.
GUARD = """
CREATE OR REPLACE FUNCTION billing_meterreading_guard() RETURNS trigger AS $$
DECLARE
    original billing_meterreading%%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'A meter reading is never deleted; void it instead.'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- A replacement corrects a void reading of the same tenancy. A replaced id that
        -- doesn't exist is refused here too (the foreign key would refuse it as well).
        IF NEW.replaces_reading_id IS NOT NULL THEN
            SELECT * INTO original FROM billing_meterreading WHERE id = NEW.replaces_reading_id;
            IF original.status IS DISTINCT FROM 'void'
               OR original.tenancy_id IS DISTINCT FROM NEW.tenancy_id THEN
                RAISE EXCEPTION 'A replacement must replace a void reading of the same tenancy.'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: what was read, when, by whom and under which key never changes.
    IF (NEW.id, NEW.tenancy_id, NEW.reading, NEW.read_on, NEW.notes, NEW.created_by_id,
        NEW.created_at, NEW.idempotency_key, NEW.fingerprint, NEW.replaces_reading_id%(new_units)s)
       IS DISTINCT FROM
       (OLD.id, OLD.tenancy_id, OLD.reading, OLD.read_on, OLD.notes, OLD.created_by_id,
        OLD.created_at, OLD.idempotency_key, OLD.fingerprint, OLD.replaces_reading_id%(old_units)s) THEN
        RAISE EXCEPTION 'A meter reading is never edited; void it and record another.'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    -- Active becomes void once, and a void reading stays as it was voided.
    IF OLD.status = 'void'
       AND (NEW.status, NEW.voided_at, NEW.voided_by_id, NEW.void_reason)
           IS DISTINCT FROM
           (OLD.status, OLD.voided_at, OLD.voided_by_id, OLD.void_reason) THEN
        RAISE EXCEPTION 'A void meter reading stays void.'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

# %-formatting turns %%ROWTYPE back into %ROWTYPE.
WITH_UNITS = GUARD % {"new_units": ", NEW.entered_units", "old_units": ", OLD.entered_units"}
WITHOUT_UNITS = GUARD % {"new_units": "", "old_units": ""}


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0016_meter_bill_readings_match"),
    ]

    operations = [
        migrations.AddField(
            model_name="meterreading",
            name="entered_units",
            field=models.DecimalField(
                blank=True, decimal_places=3, editable=False, max_digits=10, null=True
            ),
        ),
        migrations.AddConstraint(
            model_name="meterreading",
            constraint=models.CheckConstraint(
                condition=models.Q(entered_units__isnull=True)
                | models.Q(entered_units__gte=0),
                name="meter_reading_entered_units_not_negative",
            ),
        ),
        # The function must change after the column exists (it names it) and go back before
        # the column is dropped.
        migrations.RunSQL(WITH_UNITS, reverse_sql=WITHOUT_UNITS),
    ]
