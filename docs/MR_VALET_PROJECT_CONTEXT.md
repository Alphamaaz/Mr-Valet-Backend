# Mr. Valet VPMS Project Context

Source document: `C:\Users\dell\Downloads\MrValet_App_Flow_Document (1).docx`

Version captured: VPMS Application Flow Document, Version 1.0, April 2026.

This file is the working memory for the backend implementation. Keep it updated when the client changes the flow.

## Product Summary

Mr. Valet VPMS is a multi-role valet parking management system that controls the full vehicle journey from reception to delivery, payment, closure, and reporting.

One transaction represents one complete vehicle journey:

`Reception -> Ticket Issued -> Parked -> Retrieval Requested -> Delivery Assigned -> Arrived -> Delivered -> Paid -> Closed`

Transactions must start from the Receptionist flow. A transaction cannot be edited or deleted after creation. It cannot be cancelled. It can only be closed after vehicle delivery and payment completion.

## Roles

- `RECEPTIONIST`: Creates transactions, issues tickets, processes payments, requests retrieval, manages ticket actions.
- `DRIVER`: Parks vehicles, reports damage, delivers vehicles, updates task statuses.
- `KEY_CONTROLLER`: Manages keys, monitors key return, assigns/release keys for delivery.
- `SUPERVISOR`: Monitors a location, has receptionist-level ticket management, handles exceptions and approvals.
- `OPERATIONS_MANAGER`: Read-only multi-location analytics, reports, incident/free-of-charge approvals.
- `OWNER`: Car owner/customer app user.
- `SUPER_ADMIN`: Backend/admin configuration owner for branches, services, pricing, ticket method, campaigns, memberships, tax, ads, etc.

## Staff Authentication And Attendance

All staff roles must complete daily sign-in before app access.

Required sign-in flow:

1. Select role.
2. Authenticate by biometrics or phone OTP.
3. Select assigned location.
4. Scan dynamic location QR shown on a dedicated branch device.
5. QR rotates every 30 seconds.
6. Backend validates GPS location against branch coordinates/radius.
7. User confirms Start Shift.

Security rules:

- Staff session expires after 18 hours.
- Staff cannot access app outside duty time.
- Multi-device login is blocked.
- Device change requires approval.
- No off-duty exploration/history access.
- Owner app does not require daily location sign-in.

## Branch Configuration

Each branch/location must be configurable by admin:

- Coordinates and allowed attendance radius.
- Service types and pricing, for example `NORMAL_VALET`, `VIP_VALET`.
- Ticket generation method. Receptionist should see only the configured method, not all methods.
- Payment conditions allowed.
- Dedicated key controller, if any.
- Key return SLA, default 90 seconds.
- VAT/tax settings.
- Campaigns, memberships, loyalty rules, ads.

Key controller rule:

- If a dedicated key controller exists, Receptionist has read-only key monitoring and Supervisor cannot release keys or assign delivery drivers.
- If no key controller exists, Receptionist or Supervisor can perform key-controller duties.

## Transaction Lifecycle

Target statuses:

1. `NEW_TRANSACTION_CREATED`
2. `READY_TO_BE_PARKED`
3. `PARKED_IN`
4. `REQUESTED_FOR_DELIVERY`
5. `ASSIGNED_FOR_DELIVERY`
6. `ON_THE_WAY`
7. `ARRIVED_FOR_DELIVERY`
8. `DELIVERED`
9. `CLOSED`

Payment status is separate from car status.

Payment statuses:

- `UNPAID`
- `PAID`
- `PREPAID`
- `CAMPAIGN`
- `MEMBERSHIP`

Closure rule:

- Auto-close only when vehicle status is `DELIVERED` and payment is resolved.
- Closed transactions are locked and move to history/reporting.

## Correct Ticket Creation Flow

Ticket creation should happen only after the selected ticket/entry method succeeds.

Frontend flow:

1. Receptionist selects service type.
2. Receptionist selects payment condition.
3. Receptionist captures/reviews vehicle data.
4. Receptionist optionally selects add-on services.
5. Receptionist selects/uses the branch ticket method.
6. Entry method succeeds.
7. Backend creates the transaction and issues ticket.
8. Status becomes `READY_TO_BE_PARKED` if driver is assigned, otherwise `NEW_TRANSACTION_CREATED`.

Backend must not create the final transaction before entry method success.

## Service Types Vs Add-On Services

`serviceType` is the main valet package:

- Normal Valet
- VIP Valet
- Other branch-defined packages

`services` are optional add-ons:

- Car Wash
- Refueling
- Tire Air Check
- Baggage Support
- Golf Cart Shuttling

`serviceType` should be required for final ticket creation. `services` should remain optional.

## Ticket Generation Methods

Supported methods:

- WhatsApp QR: Guest scans QR and WhatsApp opens with ticket/request flow.
- SMS: Ticket sent to guest phone with request link.
- NFC Card: Receptionist writes transaction data to card. Card is erased after closure.
- Classic Ticket: Pre-printed barcode/QR ticket linked to transaction.
- Thermal Ticket: Bluetooth printer prints assigned ticket.
- QR Code Customer App: Receptionist scans QR displayed in owner app.
- Customer App Direct: Ticket delivered directly in owner app.

Each branch should have one configured ticket method. Receptionist should not select from every method unless the branch config allows it.

## Parking Flow

Driver home sections:

- Ready to be Parked
- Assigned to be Delivered
- Parked Cars

Parking steps:

1. Driver is assigned or self-assigns a ready-to-park ticket.
2. Driver parks the vehicle.
3. Driver updates status to `PARKED_IN`.
4. Optional: slot, zone, photo, damage report.
5. Driver must return key within 90 seconds.
6. If timer expires, notify Key Controller, Receptionist, Supervisor.

## Retrieval And Delivery Flow

Retrieval can be requested by:

- Owner app: Request My Car.
- Receptionist: Guest asks at valet point.
- WhatsApp/SMS link if branch supports it.

Retrieval request goes to Key Controller and Receptionist.

Delivery steps:

1. Ticket status becomes `REQUESTED_FOR_DELIVERY`.
2. Key Controller assigns driver and releases key.
3. Status becomes `ASSIGNED_FOR_DELIVERY`.
4. Driver collects key and retrieves vehicle.
5. Driver updates `ON_THE_WAY`.
6. Driver reaches lobby and updates `ARRIVED_FOR_DELIVERY`.
7. Driver/receptionist confirms handover as `DELIVERED`.

Retrieval must stay on the same transaction/ticket. Do not create a second main ticket document for retrieval.

## Payment Flow

Payment condition is selected at transaction creation:

- `PREPAID_VOUCHER`: Voucher/coupon verified before ticket creation.
- `PAY_NOW`: Cash or POS at creation.
- `PAY_LATER`: Payment at retrieval/delivery.
- `CAMPAIGN`: Promotional discount/third-party settlement.
- `MEMBERSHIP`: Membership card/ID/QR/NFC validated.
- `VALIDATION`: Third party pays on guest behalf.
- `FREE_OF_CHARGE`: Requires Supervisor or Operations Manager approval and reason.

POS card flow:

- Backend/app passes amount to POS.
- POS processes payment.
- Bank confirms via return URL/webhook.
- Store terminal ID, bank transaction reference, status, amount, timestamp.

Online payment:

- Only available through Owner app.
- If online payment fails, guest pays manually at reception.

Non-payment/refused payment:

- Receptionist creates incident report.
- Requires Supervisor and Operations Manager approval before revenue deduction.

## Incidents

Incident types:

- Lost ticket/NFC card.
- Non-payment/refused payment.
- Damage/scratch report.
- Delayed key return.

Lost ticket/NFC rules:

- Apply configurable 50-unit penalty.
- Capture guest Q ID.
- Locate car by plate.
- Capture digital signature.
- Store IP and location audit.
- Guest accepts disclaimer.

Damage report:

- Driver selects damaged zones on car diagram.
- Driver uploads photos and notes.
- Report attaches to transaction.

## Owner App Flow

Owner app shows:

- Loyalty points.
- Active transaction card.
- Vehicle status.
- Parking location.
- Assigned driver.
- ETA.
- Actions: Request My Car, Add Services, View Summary, Pay Online.

Post-delivery:

- Rate driver/team.
- Tip driver.
- View receipt.
- Earn/redeem loyalty points.

## Notifications

Required events:

- Car Received -> Owner.
- Car Parked -> Owner.
- Retrieval Requested -> Key Controller, Receptionist.
- Driver Assigned -> Driver, Owner.
- Car On The Way -> Owner.
- Car Arrived -> Owner, Receptionist.
- Car Delivered -> Owner.
- Key Return Timer Expired -> Key Controller, Receptionist, Supervisor.
- Payment Received -> Owner.
- Incident Submitted -> Supervisor, Operations Manager.

Channels:

- App push/in-app.
- WhatsApp where supported.
- SMS where supported.

## Reports

Required reports:

- Daily reconciliation: cash, POS, online, campaign, membership, prepaid voucher, validation, revenue summary.
- Operational: cars received/parked/delivered, average parking/delivery time, VIP vs normal, stuck/delayed transactions.
- HR/attendance: check-in/out, shift hours, QR sign-in logs.
- Management analytics: revenue by location/date/service, car type distribution, peak hours, employee performance.

## Current Backend Direction

Important implementation decisions already aligned:

- Use a single `Ticket` for the complete vehicle journey.
- Do not create a second main ticket for retrieval.
- Keep `parkingDriver` and `deliveryDriver` separate.
- `serviceType` is main valet package.
- `services` are optional add-ons.
- `paymentCondition` is chosen at ticket creation.
- Ticket should be created after entry method succeeds.

## Performance And Scalability Requirements

The system must be written with high optimization standards because expected production volume is high:

- Around 10,000+ attendance scans, ticket scans, and valet transactions per day across multiple branches/countries.
- APIs must avoid unnecessary database queries, repeated population, and unbounded list responses.
- Every high-volume collection must have indexes for branch, status, user, date, ticket number, valet code, owner phone, and active workflow filters.
- List endpoints must use pagination, limits, filtering, and lean queries where possible.
- Real-time notifications should use event-driven Socket.IO/Redis or push queues, not blocking request handlers.
- Payment, WhatsApp/SMS, push notifications, and reports should be async/queued where possible.
- QR validation must be stateless and fast, using signed short-lived tokens for dynamic QR.
- Reports and analytics should use aggregation pipelines, cached summaries, or background jobs instead of heavy live scans on large collections.
- Multi-country deployment must keep branch/location isolation in all queries.
- Never expose all countries/branches data to a branch-level role.
- Avoid creating duplicate documents for one journey unless the domain explicitly requires a child record.
- Prefer idempotent APIs for scan/payment/webhook operations to prevent duplicate ticket or attendance records during retries.
- Design for horizontal scaling with Redis-backed Socket.IO and stateless API containers.
- Keep payloads small, especially for mobile scan flows.

## Next Backend Priorities

1. Make final ticket creation require `serviceType`, `paymentCondition`, `entryMethod`, and successful entry-method result.
2. Add payment processing endpoints and close-ticket rules.
3. Add POS/payment metadata and reconciliation.
4. Add voucher/campaign/membership validation.
5. Add incident approval workflow.
6. Add dynamic attendance QR with 30-second rotation and 18-hour session enforcement.
7. Add key-return timer alert job.
8. Add branch-level ticket method restrictions.
9. Add FCM/push notification service.
10. Add reporting endpoints.
