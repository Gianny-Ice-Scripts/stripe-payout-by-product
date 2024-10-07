# Stripe Payout by Product

This script retrieves payout information for a specific product from Stripe. It displays both upcoming expected payouts and already paid invoices using the product ID.

The script will prompt you for the Stripe API Key and the Product ID.

## Prerequisites

- **Node.js** installed.
- **Stripe API** key stored in **LastPass** under the entry **AFFL Stripe API Key**.

## Setup Instructions

1. **Clone the Repository**

   ```bash
   git clone https://github.com/Gianny-Ice-Scripts/stripe-payout-by-product.git
   cd stripe-payout-by-product
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Retrieve API Key**  
   Obtain the API key from LastPass entry **AFFL Stripe API Key**:

   ```bash
   export STRIPE_API_KEY=your_api_key_here
   ```

4. **Run the Script**  
   Run the script:

   ```bash
   node payout_by_product.js
   ```
