# Tax Management

This guide explains how to set up tax jurisdictions, configure tax components, apply default tax rates to checkouts, and mark inventory items as taxable.

---

## 1. Setting Up Tax Jurisdictions

Sales tax calculation is determined by the shopper's tax jurisdiction. You can configure jurisdictions under **Merchant** → **Reserve** → **Tax Management** in the Admin Sidebar.

### Option A: Using Preset Jurisdictions
1. Scroll to the **Tax Presets** section.
2. Select a preset (e.g., standard state/regional rates).
3. Click **Add Jurisdiction**. It will now appear in your active list.

### Option B: Building a Custom Jurisdiction
If your business operates in a locality with unique tax combinations (e.g., state + county + city rates), you can build a custom jurisdiction:
1. Click **Create Custom Jurisdiction** (or open the Jurisdiction Builder modal).
2. Enter a **Name** (e.g., `Los Angeles retail tax`) and a **Code** (e.g., `US-CA-LA`).
3. Add **Tax Components**:
    *   *Component Name*: (e.g., "State Sales Tax")
    *   *Component Code*: (e.g., "STATE")
    *   *Rate (Percentage)*: (e.g., `7.25` for 7.25%)
4. Add additional components if needed (e.g., "County Tax" at `1.00%` and "District Tax" at `1.25%`).
5. Click **Save Jurisdiction**. The system automatically sums the components to calculate the total rate (in this example, `9.50%`).

---

## 2. Setting Your Default Jurisdiction

To ensure sales taxes are applied to all orders automatically:
1. Under **Tax Management**, locate the **Default Jurisdiction** dropdown.
2. Select your primary jurisdiction (e.g., your storefront location).
3. Click **Save Default**.
All newly generated receipts and portal checkout pages will use this default rate unless specified otherwise.

---

## 3. Applying Tax to Products

Taxes are only calculated on items marked as taxable in your catalog:
1. Open **Inventory** and click Edit on an item.
2. Locate the **Taxable** toggle.
    *   **Taxable (Enabled)**: The item is subject to sales tax.
    *   **Taxable (Disabled)**: The item is tax-exempt (e.g., services, certain groceries, or medications).
3. Save the product.

---

## 4. Tax Math & Checkout Flow

When an order is created, taxes and fees are processed sequentially:

1.  **Subtotal Calculation**: Sum of all items.
2.  **Taxable Subtotal**: Sum of only items marked `taxable: true`.
3.  **Tax Amount**: Multiply the taxable subtotal by the active jurisdiction's rate:
    $$\text{Tax} = \text{Taxable Subtotal} \times \text{Tax Rate}$$
4.  **Post-Tax Subtotal**: Sum of Subtotal + Tax.
5.  **Processing Fee**: Calculated on the post-tax subtotal (Base platform fee + any merchant add-on fees):
    $$\text{Fee} = (\text{Subtotal} + \text{Tax}) \times \text{Fee Rate}$$
6.  **Grand Total**: Sum of Subtotal + Tax + Processing Fee.

*Example Checkout*:
*   Taxable Book: $20.00 (Taxable = Yes)
*   Service Fee: $10.00 (Taxable = No)
*   Jurisdiction: `US-CA` (Rate = 8.00%)
*   Processing Fee: 2.00%
*   *Math*:
    *   Subtotal = $30.00
    *   Taxable Subtotal = $20.00
    *   Tax = \$20.00 * 8.00% = $1.60
    *   Post-Tax Subtotal = $31.60
    *   Processing Fee = \$31.60 * 2.00% = $0.63
    *   Grand Total = $32.23
