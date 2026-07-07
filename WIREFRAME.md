# Stellar Shield Dashboard Wireframe

This document is a discussion draft for a lending and borrowing dashboard with private verification on Stellar. It keeps the first implementation small: one useful vertical slice from wallet connection to a submitted transaction.

## Product Direction

The interface should feel like a modern banking dashboard, not a crypto trading terminal.

- User-facing language stays normal: `Loan`, `Collateral`, `Verification`, `Activity`, `Available to borrow`.
- Technical language stays mostly hidden: `ZKP`, `proof`, `oracle`, `contract`, and `pool` are not primary UI labels.
- The main promise is private eligibility checking, not anonymous finance.
- Lending and borrowing markets are public. Anyone can compare rates and liquidity before connecting a wallet.
- Stellar is the default network context. Do not show a network selector or persistent network badge in the normal product UI.
- `Connect wallet` lives in the header. When disconnected, show only the connect action. After connection, replace it with notifications and the user menu.
- The app should be dense enough for repeat financial use, but calm and readable.

Design tone: restrained financial workspace. Quiet surfaces, sharp hierarchy, compact numbers, clear status labels, and minimal decoration.

## Header

The root route is `/`. The header is not a navigation menu. It holds the brand, search, and wallet-dependent actions.

Disconnected:

```txt
Stellar Shield        Search                              [Connect wallet]
```

Connected:

```txt
Stellar Shield        Search                  Notifications   User
```

Secondary pages move to the user menu:

- `Proofs`: private verification status and history.
- `Activity`: transactions, confirmations, failures, and receipts.

## MVP Slice

Build this first:

```txt
Browse markets
  -> Select market
  -> Connect wallet
  -> Review account summary
  -> Add collateral
  -> Run private verification
  -> Review borrow terms
  -> Sign transaction
  -> Track transaction status
  -> Show receipt in Activity
```

Do not build every lending feature yet. The first slice only needs one market, one wallet, one collateral input, one borrow input, one verification result, and one transaction receipt.

## Core Data

Minimal state required for the first UI:

```txt
Wallet
- connected: boolean
- address: string
- balance: amount

Market
- asset: "XLM" | "USDC"
- supplyApy: percent
- borrowApr: percent
- availableLiquidity: amount

Position
- suppliedCollateral: amount
- borrowedAmount: amount
- borrowingPower: amount
- loanStatus: "Healthy" | "Attention" | "At risk"

Verification
- status: "Not started" | "Checking" | "Verified" | "Failed" | "Expired"
- expiresAt: datetime

Transaction
- status: "Draft" | "Awaiting signature" | "Submitted" | "Confirmed" | "Failed"
- hash: string
- timestamp: datetime
```

## App Start Page

The first screen should open directly on public lending markets and a borrow preview. The user should see rates, liquidity, and borrowing context before connecting a wallet.

Card composition:

```txt
Frame
  FrameHeader: title, description, small status badge
  Card
    CardPanel: chart, market metrics, or borrow form fields
  FrameFooter: short helper note
```

Use this pattern for public market cards and the borrow preview so the dashboard stays consistent with coss particles while keeping the content compact.

```txt
┌─────────────────────────────────────────────────────────────────────────────┐
│ Navbar                                                                      │
│ Stellar Shield        Search                              Connect wallet    │
├─────────────────────────────────────────────────────────────────────────────┤
│ Markets first, wallet later.                          [Start borrow request]│
│ Compare rates and liquidity before connecting.                              │
├───────────────────────────────┬───────────────────────────────┬─────────────┤
│ USDC Market                   │ XLM Market                    │ Borrow      │
│ Dollar liquidity              │ Native asset market           │ readiness   │
│ [line chart]                  │ [line chart]                  │ [line chart]│
│ Supply APY 4.1%               │ Supply APY 3.2%               │ Available   │
│ Borrow APR 7.4%               │ Borrow APR 6.8%               │ $4,250.00   │
│ Available $840K               │ Available $1.2M               │             │
│ [View]                        │ [View]                        │ [Review]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Start Page States

Disconnected:

```txt
┌─────────────────────────────────────────────────────────────────────────────┐
│ Markets                                                                     │
│ Compare lending and borrowing markets before connecting your wallet.         │
├─────────────────────────────────────────────────────────────────────────────┤
│ USDC Market [chart]    XLM Market [chart]    Borrow readiness [chart]       │
├─────────────────────────────────────────────────────────────────────────────┤
│ Connect from the header to add collateral, verify eligibility, or submit.    │
└─────────────────────────────────────────────────────────────────────────────┘
```

Connected but not verified:

```txt
Private verification
Status: Not started
Confirm your eligibility without exposing sensitive financial details.
[Verify eligibility]
```

Verified:

```txt
Private verification
Status: Verified
You can borrow up to $4,250.00 based on your current collateral.
[Refresh verification]
```

Failed:

```txt
Private verification
Status: Verification failed
We could not confirm your eligibility. Review collateral or try again.
[Try again]
```

## Connect Wallet Flow

Use a modal or compact dialog. The flow should be short and explicit.

```txt
┌──────────────────────────────┐
│ Connect wallet               │
│ Choose an account to use     │
│ with Stellar Shield.         │
│                              │
│ [Freighter]                  │
│ [WalletConnect]              │
└──────────────────────────────┘
```

After connection:

```txt
Connected account
GABC...7KQ2
Balance: 3,420.24 XLM
```

Error state:

```txt
Connection failed
The wallet request was rejected or expired.
[Try again]
```

## Borrow Flow

The Borrow route can be a focused version of the same flow. It should not require the user to jump across pages.

```txt
┌─────────────────────────────────────────────────────────────────────────────┐
│ Borrow                                                                      │
│ Apply for a loan using verified collateral.                                 │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ Stepper                       │ Borrow details                              │
│ 1 Collateral                  │ Market                                      │
│ 2 Verification                │ [USDC]                                      │
│ 3 Review                      │                                             │
│ 4 Sign                        │ Collateral                                  │
│                               │ [2,400 XLM]                                 │
│                               │                                             │
│                               │ Loan amount                                 │
│                               │ [1,200 USDC]                                │
│                               │                                             │
│                               │ Estimated APR: 7.4%                         │
│                               │ Available to borrow: $4,250.00              │
│                               │                                             │
│                               │ [Continue]                                  │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

### Step 1: Collateral

User enters collateral and desired loan amount.

Validation:

- Loan amount cannot exceed available borrowing power.
- Collateral must be greater than zero.
- If privacy mode is enabled, amounts can be masked outside focused inputs.

Primary copy:

```txt
Add collateral
Choose how much collateral you want to use for this loan.
```

### Step 2: Private Verification

This is where the ZKP system appears, but the UI keeps it normal.

```txt
Private verification
Confirm eligibility without exposing sensitive financial details.

Status: Ready
[Verify eligibility]
```

Loading:

```txt
Checking eligibility
This may take a few seconds. Keep this window open.
```

Success:

```txt
Verification complete
You are eligible to continue with this loan request.
[Continue]
```

Failure:

```txt
Verification failed
We could not confirm eligibility for this request.
[Adjust request] [Try again]
```

Internal technical note: this can start as a stubbed verification result. The UI only needs the status contract first. Replace the stub with the actual proof verifier after the flow is clear.

### Step 3: Review

Review should look like a bank confirmation screen.

```txt
Review loan request

Collateral
2,400 XLM

Loan amount
1,200 USDC

Borrow APR
7.4%

Loan status after borrowing
Healthy

Private verification
Verified

[Back] [Confirm and sign]
```

Avoid legal-heavy copy in this screen. Put detailed terms behind `Terms & Conditions` in the user menu.

### Step 4: Sign

```txt
Awaiting wallet signature
Confirm this transaction in your wallet.

Request
Borrow 1,200 USDC using 2,400 XLM as collateral.

[Waiting for wallet]
```

Rejected:

```txt
Signature rejected
No transaction was submitted.
[Review request]
```

### Step 5: Transaction Status

```txt
Transaction submitted
Waiting for confirmation on Stellar.

Transaction hash
9e4f...a21c

[View activity]
```

Confirmed:

```txt
Loan active
Your loan was confirmed and is now visible in your account summary.

[Go to Markets] [View receipt]
```

Failed:

```txt
Transaction failed
This transaction could not be completed.

Reason
Insufficient collateral or expired verification.

[Try again]
```

## Markets Page

Markets is for comparison and selection, not trading.

```txt
Markets
Compare available lending and borrowing products.

Asset   Supply APY   Borrow APR   Available funds   Risk level   Action
XLM     3.2%         6.8%         $1.2M             Standard     [View]
USDC    4.1%         7.4%         $840K             Standard     [View]
```

Market detail panel:

```txt
USDC Market
Available funds: $840K
Borrow APR: 7.4%
Supply APY: 4.1%

[Supply] [Borrow]
```

## Proofs Page

Keep the route name `Proofs`, but the page copy can still be user-friendly.

```txt
Proofs
Private verification history

Status        Request              Expires        Action
Verified      Borrow eligibility   6 days         [View details]
Expired       Borrow eligibility   Expired        [Renew]
Failed        Borrow eligibility   -              [Retry]
```

Detail view:

```txt
Verification details
Type: Borrow eligibility
Status: Verified
Created: Jul 6, 2026
Expires: Jul 12, 2026

Technical details
Proof reference: prf_...
Verifier: Stellar Shield verifier
```

The technical details section should be collapsed by default.

## Activity Page

Activity is the transaction and audit trail.

```txt
Activity

Date              Type                  Status       Amount        Reference
Jul 6, 2026       Verification          Complete     -             prf_...
Jul 6, 2026       Add collateral         Confirmed    2,400 XLM     tx_...
Jul 6, 2026       Borrow                 Confirmed    1,200 USDC    tx_...
```

Receipt:

```txt
Transaction receipt
Status: Confirmed
Type: Borrow
Amount: 1,200 USDC
Collateral: 2,400 XLM
Transaction hash: 9e4f...a21c

[Copy hash] [Open in explorer]
```

## Notifications

Notification language should match the dashboard:

```txt
Verification complete
Loan status updated
Collateral added
Transaction confirmed
Verification expired
```

Avoid:

```txt
Proof generated
Oracle updated
Contract invocation complete
```

## Privacy Mode Behavior

When privacy mode is enabled:

```txt
$4,250.00     -> ••••••
2,400 XLM     -> ••••••
GABC...7KQ2   -> GABC••••7KQ2
```

Do not hide status labels. The user still needs to understand whether the account is healthy, pending, or failed.

## Component Plan

Keep components small and composable:

```txt
app/_components/
- app-navbar.tsx
- wallet-connect-dialog.tsx
- overview-summary.tsx
- market-table.tsx
- position-summary.tsx
- borrow-flow.tsx
- verification-status.tsx
- transaction-status.tsx
- activity-list.tsx
```

Constants:

```txt
app/_constants/
- routes.ts
- markets.ts
- activity.ts
- verification.ts
```

Do not create a global state architecture yet. Start with local mocked data and a narrow transaction state machine. Promote state only when multiple real screens need it.

## First Implementation Checklist

1. Build public Markets and Borrow cards with header-only `Connect wallet`.
2. Stub wallet connection with one sample account.
3. Show account summary after connection.
4. Add one market row: `USDC`.
5. Build Borrow flow with local state.
6. Stub private verification with `Verified` and `Failed` states.
7. Stub transaction lifecycle: `Awaiting signature -> Submitted -> Confirmed`.
8. Write one Activity receipt after confirmed transaction.
9. Add privacy mode masking helper after real numbers appear.

## Open Decisions

These need product decisions before implementation grows:

1. Is collateral supplied before borrowing, or inside the same transaction as borrow?
2. Is private verification required for every borrow, or only above a threshold?
3. Should verification expire by time, by market, or by loan amount?
4. Should internal development target Testnet only while keeping network labels hidden from users?
5. Should `Proofs` and `Activity` stay in the user menu, or receive dedicated top-level pages later?
