# Shop Setup & Catalog Customization

This guide walks you through claiming your custom store link, uploading products to your inventory, and configuring product modifiers for customized sales.

---

## 1. Claiming Your Shop Slug

To publish your shop, you must first claim a unique web handle (slug):

1. Navigate to the **General** section of the Admin Sidebar and click **My Profile** (or select the **Profile Setup** manual).
2. Enter your **Display Name** and a unique **Shop Slug** (e.g., `central-cafe`).
3. Upload an **Avatar / Store Logo** to customize the top header.
4. Click **Save Changes**. Your public store is instantly live at:
   `https://<your-branded-domain>/shop/<your-slug>`

---

## 2. Managing Inventory Items

From the Admin Sidebar under **Merchant**, click **Inventory**. Here you can manage your digital or physical product catalog:

*   **SKU (Stock Keeping Unit)**: A unique identifier for the product (e.g., `BF-CHBG-01` for a cheeseburger). Keep SKUs structured and do not reuse deleted SKUs.
*   **Name & Description**: Detailed descriptions and high-quality images (preferably WebP) will improve shopper conversion.
*   **Price (USD)**: Enter prices in standard USD. Payouts are calculated in USD value and processed on-chain in your customer's cryptocurrency of choice at real-time conversion rates.
*   **Stock Quantity**:
    *   *Physical Goods*: Input positive integers (e.g., `50`). The system automatically decrements stock on successful payments and marks items as out-of-stock when depleted.
    *   *Digital / Services*: Input `-1` to set unlimited stock.
*   **Taxable Toggle**: Mark items as taxable if they are subject to local sales tax (see [Tax Management](./tax-management.md) to set jurisdiction rates).

---

## 3. Product Modifiers & Modifier Groups

For items that require customization (such as adding toppings to a burger, selecting sizes for apparel, or configuring service options), you can set up **Modifier Groups**:

### What is a Modifier Group?
A modifier group is a container for individual customization options (similar to POS setups like Toast). Examples include:
*   *Group*: "Cheese Selection" (Modifiers: Cheddar +$0.50, Swiss +$0.50, None)
*   *Group*: "T-Shirt Size" (Modifiers: Small, Medium, Large +$2.00)

### Configuring Modifiers in the Dashboard:
1. When adding or editing an inventory item, scroll down to the **Modifiers** section.
2. Click **Create Modifier Group**:
    *   **Group Name**: The label shown to shoppers (e.g., "Add Ons").
    *   **Min/Max Selections**: Controls constraints. (e.g., Min = 1, Max = 1 forces the customer to pick exactly one option).
    *   **Required Toggle**: If enabled, shoppers cannot add the item to their cart without making a selection.
3. Add **Modifier Options** within the group:
    *   **Option Name**: (e.g., "Extra Patty").
    *   **Price Adjustment**: The USD value added to (or subtracted from) the base price when selected (e.g., `+2.50` or `0.00`).
    *   **Default Toggle**: If checked, this option is pre-selected for the customer.
    *   **Availability**: Disable options that are temporarily out of stock.
4. Click **Save Product**.

### Cart Pricing Math
When a shopper selects modifiers, the system dynamically calculates the item line total during checkout:
$$\text{Line Total} = (\text{Base Price} + \text{Modifier Adjustments}) \times \text{Quantity}$$

*Example*: Base Burger ($10.00) + Extra Cheese (+$0.50) + Gluten-Free Bun (+$1.00) = $11.50 per burger.
