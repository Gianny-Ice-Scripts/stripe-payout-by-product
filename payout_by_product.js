const stripe = require("stripe")("sk_live_xxx");
const readline = require("readline");
const Table = require("cli-table");

// Function to convert month and year input (e.g., 'MM-YYYY') to start and end Unix timestamps
function getMonthTtimestamps(monthYearString) {
  const [month, year] = monthYearString.split("-");
  const startDate = new Date(`${year}-${month}-01T00:00:00`);

  // Calculate the last day of the month by setting the date to 0 of the next month
  const endDate = new Date(`${year}-${month}-01T23:59:59`);
  endDate.setMonth(endDate.getMonth() + 1); // Move to the next month
  endDate.setDate(0); // Set to the last day of the previous month

  return {
    startTimestamp: Math.floor(startDate.getTime() / 1000),
    endTimestamp: Math.floor(endDate.getTime() / 1000),
    startDateFormatted: startDate.toISOString().split("T")[0],
    endDateFormatted: endDate.toISOString().split("T")[0],
  };
}

// Function to prompt for input
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

async function fetchAndProcessCharges(
  productIdToFilter,
  startTimestamp,
  endTimestamp
) {
  let records = [];
  let hasMore = true;
  let lastChargeId = null;
  let batchCount = 1;

  const subscriptionCache = {};
  const invoiceCache = {};
  const balanceTransactionCache = {};

  console.log(
    `\nStarting to fetch Charges for product ID: ${productIdToFilter}...\n`
  );

  while (hasMore) {
    console.log(`Fetching Charge batch #${batchCount}...`);

    const params = {
      limit: 100, // Keep it at 100 for now; Stripe allows up to 100
      created: {
        gte: startTimestamp, // Start date
        lte: endTimestamp, // End date
      },
    };

    if (lastChargeId) {
      params.starting_after = lastChargeId;
    }

    // Fetch charges
    const charges = await stripe.charges.list(params);
    console.log(`Fetched ${charges.data.length} Charges.`);

    // Process charges in parallel where possible
    const chargeProcessingPromises = charges.data.map(async (charge) => {
      const invoiceId = charge.invoice;
      if (!invoiceId) {
        console.log(`Charge ${charge.id} has no associated invoice.`);
        return;
      }

      // Retrieve the invoice, check cache first
      let invoice = invoiceCache[invoiceId];
      if (!invoice) {
        invoice = await stripe.invoices.retrieve(invoiceId);
        invoiceCache[invoiceId] = invoice; // Cache the result
      }

      const subscriptionId = invoice.subscription;
      if (!subscriptionId) {
        console.log(`Invoice ${invoiceId} has no associated subscription.`);
        return;
      }

      // Retrieve the subscription, check cache first
      let subscription = subscriptionCache[subscriptionId];
      if (!subscription) {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
        subscriptionCache[subscriptionId] = subscription; // Cache the result
      }

      const items = subscription.items.data;

      // Check if any of the subscription items match the desired product ID
      const matchingItem = items.find(
        (item) => item.price.product === productIdToFilter
      );

      if (!matchingItem || !charge.balance_transaction) {
        console.log(
          `Charge ${charge.id} does not match the product ID or has no balance transaction.`
        );
        return;
      }

      // Retrieve the balance transaction, check cache first
      let balanceTransaction =
        balanceTransactionCache[charge.balance_transaction];
      if (!balanceTransaction) {
        balanceTransaction = await stripe.balanceTransactions.retrieve(
          charge.balance_transaction
        );
        balanceTransactionCache[charge.balance_transaction] =
          balanceTransaction; // Cache the result
      }

      records.push({
        customer_id: charge.customer,
        product_id: productIdToFilter,
        invoice_date: new Date(charge.created * 1000)
          .toISOString()
          .split("T")[0],
        amount: charge.amount / 100,
        processing_fee: balanceTransaction.fee / 100,
      });
    });

    // Wait for all charge processing promises to complete
    await Promise.all(chargeProcessingPromises);

    hasMore = charges.has_more;
    if (charges.data.length > 0) {
      lastChargeId = charges.data[charges.data.length - 1].id;
    }

    batchCount++;
  }

  console.log(
    `Finished fetching and processing charges. Total records: ${records.length}`
  );
  return records;
}

async function fetchAndProcessPendingInvoiceItems(
  productIdToFilter,
  startTimestamp,
  endTimestamp
) {
  let records = [];
  let hasMore = true;
  let lastInvoiceItemId = null;
  let batchCount = 1;

  console.log(
    `\nStarting to fetch Pending Invoice Items for product ID: ${productIdToFilter}...\n`
  );

  while (hasMore) {
    console.log(`Fetching Pending Invoice Item batch #${batchCount}...`);

    const params = {
      limit: 100,
      created: {
        gte: startTimestamp, // Start date
        lte: endTimestamp, // End date
      },
    };

    if (lastInvoiceItemId) {
      params.starting_after = lastInvoiceItemId;
    }

    const invoiceItems = await stripe.invoiceItems.list(params);
    console.log(`Fetched ${invoiceItems.data.length} Pending Invoice Items.`);

    for (const item of invoiceItems.data) {
      if (item.price && item.price.product === productIdToFilter) {
        // Use the period start and end to ensure the item is within the correct month
        const periodStart = item.period.start;
        const periodEnd = item.period.end;

        if (periodEnd <= endTimestamp && periodStart >= startTimestamp) {
          const createdDate = item.date ? new Date(item.date * 1000) : null;

          if (createdDate && !isNaN(createdDate.getTime())) {
            records.push({
              customer_id: item.customer,
              product_id: productIdToFilter,
              pending_invoice_date: createdDate.toISOString().split("T")[0],
              amount: item.amount / 100,
              processing_fee: 0,
            });
          } else {
            console.error(
              `Invoice Item ${item.id} has an invalid 'date' timestamp. Skipping.`
            );
          }
        } else {
          console.log(
            `Invoice Item ${item.id} is outside the specified date range.`
          );
        }
      } else {
        console.log(
          `Pending Invoice Item ${item.id} does not match product ${productIdToFilter}.`
        );
      }
    }

    hasMore = invoiceItems.has_more;
    if (invoiceItems.data.length > 0) {
      lastInvoiceItemId = invoiceItems.data[invoiceItems.data.length - 1].id;
    }

    batchCount++;
  }

  console.log(
    `Finished fetching and processing invoice items. Total records: ${records.length}`
  );
  return records;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMonthYear(timestamp) {
  const date = new Date(timestamp * 1000);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

// Function to display pending invoice items in a table with totals and net amounts
function displayPendingInvoiceItems(records) {
  const table = new Table({
    head: ["Customer", "Product", "Invoice Date", "Amount", "Fees", "Net"],
    colWidths: [20, 20, 20, 10, 10, 10],
  });

  let totalAmount = 0;
  let totalProcessingFees = 0;
  let totalNet = 0;

  records.forEach((record) => {
    const netAmount = record.amount - record.processing_fee;
    totalAmount += record.amount;
    totalProcessingFees += record.processing_fee;
    totalNet += netAmount;

    table.push([
      record.customer_id,
      record.product_id,
      formatDate(record.pending_invoice_date), // Format the date for better readability
      `$${record.amount.toFixed(2)}`,
      `$${record.processing_fee.toFixed(2)}`,
      `$${netAmount.toFixed(2)}`, // Display net amount
    ]);
  });

  // Add a final row for the totals
  table.push([
    "Total",
    "",
    "",
    `$${totalAmount.toFixed(2)}`,
    `$${totalProcessingFees.toFixed(2)}`,
    `$${totalNet.toFixed(2)}`, // Display total net amount
  ]);

  console.log(table.toString());
}

// Function to display charges in a table with totals and net amounts
function displayCharges(records) {
  const table = new Table({
    head: ["Customer", "Product", "Invoice Date", "Amount", "Fees", "Net"],
    colWidths: [20, 20, 20, 10, 10, 10],
  });

  let totalAmount = 0;
  let totalProcessingFees = 0;
  let totalNet = 0;

  records.forEach((record) => {
    const netAmount = record.amount - record.processing_fee;
    totalAmount += record.amount;
    totalProcessingFees += record.processing_fee;
    totalNet += netAmount;

    table.push([
      record.customer_id,
      record.product_id,
      formatDate(record.invoice_date), // Format the date for better readability
      `$${record.amount.toFixed(2)}`,
      `$${record.processing_fee.toFixed(2)}`,
      `$${netAmount.toFixed(2)}`, // Display net amount
    ]);
  });

  // Add a final row for the totals
  table.push([
    "Total",
    "",
    "",
    `$${totalAmount.toFixed(2)}`,
    `$${totalProcessingFees.toFixed(2)}`,
    `$${totalNet.toFixed(2)}`, // Display total net amount
  ]);

  console.log(table.toString());
}

async function getProductRevenueAndFees() {
  try {
    const productIdToFilter = "prod_OJ3371sGJsUPcb"; // The product ID you want to filter by

    // Prompt user for month and year
    const monthYear = await askQuestion(
      "Enter the month and year to process (MM-YYYY): "
    );
    if (!monthYear) {
      throw new Error("Invalid input for month and year");
    }
    const {
      startTimestamp,
      endTimestamp,
      startDateFormatted,
      endDateFormatted,
    } = getMonthTtimestamps(monthYear);

    // Format the month year based on start timestamp
    const formattedMonthYear = formatMonthYear(startTimestamp);

    console.log(
      `\nRetrieving payment data for product ID: ${productIdToFilter} for ${formattedMonthYear}.`
    );
    console.log(`Date range: ${startDateFormatted} to ${endDateFormatted}\n`);

    const chargesRecords = await fetchAndProcessCharges(
      productIdToFilter,
      startTimestamp,
      endTimestamp
    );
    const pendingInvoiceRecords = await fetchAndProcessPendingInvoiceItems(
      productIdToFilter,
      startTimestamp,
      endTimestamp
    );

    console.log(`\nPending Invoice Items for ${formattedMonthYear}:`);
    displayPendingInvoiceItems(pendingInvoiceRecords);

    console.log(`\nCharges for ${formattedMonthYear}:`);
    displayCharges(chargesRecords);
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

getProductRevenueAndFees().catch((error) => {
  console.error("An error occurred:", error);
});
