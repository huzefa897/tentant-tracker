from django.db import migrations

# A reading is a record of what the meter said on a day: it is never edited or deleted, only
# voided (billing/meter.py). Admin is view-only and the code never edits one, but a queryset
# update, a shell session or a script would get past both, so the database refuses it too.
# Row triggers don't fire for TRUNCATE (test cleanup and deliberate resets still work).
CREATE_GUARD = """
CREATE FUNCTION billing_meterreading_guard() RETURNS trigger AS $$
DECLARE
    original billing_meterreading%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'A meter reading is never deleted; void it instead.'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- A replacement corrects a void reading of the same tenancy.
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
        NEW.created_at, NEW.idempotency_key, NEW.fingerprint, NEW.replaces_reading_id)
       IS DISTINCT FROM
       (OLD.id, OLD.tenancy_id, OLD.reading, OLD.read_on, OLD.notes, OLD.created_by_id,
        OLD.created_at, OLD.idempotency_key, OLD.fingerprint, OLD.replaces_reading_id) THEN
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

CREATE TRIGGER billing_meterreading_guard
BEFORE INSERT OR UPDATE OR DELETE ON billing_meterreading
FOR EACH ROW EXECUTE FUNCTION billing_meterreading_guard();
"""

DROP_GUARD = """
DROP TRIGGER billing_meterreading_guard ON billing_meterreading;
DROP FUNCTION billing_meterreading_guard();
"""


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0013_meter_readings"),
    ]

    operations = [
        migrations.RunSQL(CREATE_GUARD, reverse_sql=DROP_GUARD),
    ]
