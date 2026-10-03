import type { Tenant } from '@/types/tenant'

export const mockTenants: Tenant[] = [
  {
    id: 'tenant-001',
    name: 'Shaik Zahid Ali',
    flatNumber: '202',
    rentAmount: 15000,
    rentDueDay: 11,
    electricityRate: 6,
    mobileNumber: '+918341413827',
    depositAmount: 90000,
  },
  {
    id: 'tenant-002',
    name: 'Mohammed Yusuf',
    flatNumber: '301',
    rentAmount: 18000,
    rentDueDay: 10,
    electricityRate: 6,
    mobileNumber: '+919876543210',
    depositAmount: 100000,
  },
  {
    id: 'tenant-003',
    name: 'Ali Hussain',
    flatNumber: '102',
    rentAmount: 14000,
    rentDueDay: 5,
    electricityRate: 6,
    mobileNumber: '+919123456789',
    depositAmount: 80000,
  },
]
