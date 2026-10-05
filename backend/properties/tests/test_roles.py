from django.test import SimpleTestCase

from properties.models import PropertyMembership
from properties.roles import ROLE_CAPABILITIES, Capability, role_can


class RoleCapabilityTests(SimpleTestCase):
    def test_every_role_has_capabilities_defined(self):
        self.assertEqual(set(ROLE_CAPABILITIES), set(PropertyMembership.Role.values))

    def test_owners_can_do_everything(self):
        for capability in Capability:
            with self.subTest(capability):
                self.assertTrue(role_can("owner", capability))

    def test_managers_run_day_to_day_but_not_members_or_property_details(self):
        self.assertTrue(role_can("manager", Capability.MANAGE_TENANTS))
        self.assertTrue(role_can("manager", Capability.RECORD_PAYMENTS))
        self.assertTrue(role_can("manager", Capability.ISSUE_RECEIPTS))
        self.assertFalse(role_can("manager", Capability.MANAGE_MEMBERS))
        self.assertFalse(role_can("manager", Capability.MANAGE_PROPERTY))

    def test_unknown_roles_can_do_nothing(self):
        self.assertFalse(role_can("tenant", Capability.MANAGE_TENANTS))
        self.assertFalse(role_can("", Capability.MANAGE_TENANTS))
