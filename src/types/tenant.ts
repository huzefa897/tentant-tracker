// Frontend domain model. Whatever the data source (Google Sheets later), map it to this.
export interface Tenant {
  id: string
  name: string
  flatNumber: string
  rentAmount: number
  // Day of the month rent is due (1-31)
  rentDueDay: number
  // Rupees per unit of electricity
  electricityRate: number
  // E.164, e.g. "+918341413827"
  mobileNumber: string
  depositAmount: number
}
