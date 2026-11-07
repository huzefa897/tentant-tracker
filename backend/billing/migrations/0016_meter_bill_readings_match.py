from django.db import migrations

# A meter bill is measured between two readings of its own tenancy, and they stay active while
# the bill does (billing/meter.py: electricity_for_new_bill picks them under the tenancy's lock;
# a reading a bill is measured from is refused for voiding). Plain foreign keys can't say
# either, so the database does: a script or shell session can't point a bill at another
# tenancy's reading, or void a reading under an active bill.
CREATE_GUARDS = """
CREATE FUNCTION billing_rententry_readings_match() RETURNS trigger AS $$
DECLARE
    reading_id uuid;
    found billing_meterreading%ROWTYPE;
BEGIN
    FOREACH reading_id IN ARRAY ARRAY[NEW.opening_reading_id, NEW.closing_reading_id] LOOP
        IF reading_id IS NOT NULL THEN
            SELECT * INTO found FROM billing_meterreading WHERE id = reading_id;
            IF found.tenancy_id IS DISTINCT FROM NEW.tenancy_id THEN
                RAISE EXCEPTION 'A bill is measured from its own tenancy''s readings.'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF NEW.status = 'active' AND found.status IS DISTINCT FROM 'active' THEN
                RAISE EXCEPTION 'An active bill is measured from active readings.'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_rententry_readings_match
BEFORE INSERT OR UPDATE ON billing_rententry
FOR EACH ROW EXECUTE FUNCTION billing_rententry_readings_match();

CREATE FUNCTION billing_meterreading_not_under_a_bill() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'active' AND NEW.status = 'void' AND EXISTS (
        SELECT 1 FROM billing_rententry
        WHERE status = 'active'
          AND (opening_reading_id = OLD.id OR closing_reading_id = OLD.id)
    ) THEN
        RAISE EXCEPTION 'A reading an active bill is measured from can''t be voided.'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_meterreading_not_under_a_bill
BEFORE UPDATE ON billing_meterreading
FOR EACH ROW EXECUTE FUNCTION billing_meterreading_not_under_a_bill();
"""

DROP_GUARDS = """
DROP TRIGGER billing_meterreading_not_under_a_bill ON billing_meterreading;
DROP FUNCTION billing_meterreading_not_under_a_bill();
DROP TRIGGER billing_rententry_readings_match ON billing_rententry;
DROP FUNCTION billing_rententry_readings_match();
"""


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0015_meter_billing"),
    ]

    operations = [
        migrations.RunSQL(CREATE_GUARDS, reverse_sql=DROP_GUARDS),
    ]
