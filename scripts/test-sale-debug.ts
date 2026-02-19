/**
 * Quick debug script to test createSale against Fiken API directly
 * Run: npx tsx scripts/test-sale-debug.ts
 */
import { getValidAccessToken } from "../src/fiken/auth.js";
import { createFikenClient } from "../src/fiken/client.js";

const USER_ID = "678b5c02-c4a1-4496-a479-006f257c37ab";
const COMPANY = "fiken-demo-lokal-hund-as2";

async function main() {
  const token = await getValidAccessToken(USER_ID);
  const client = createFikenClient(token, COMPANY);

  // Test 1: Only netPrice, vatType HIGH, no grossAmount
  console.log("\n=== Test 1: netPrice only, vatType HIGH ===");
  try {
    const sale1 = await client.createSale({
      date: "2026-01-07",
      kind: "cash_sale",
      paid: true,
      currency: "NOK",
      totalPaid: 25380000, // 253800 kr in øre
      paymentAccount: "1920:10001",
      paymentDate: "2026-01-07",
      lines: [{
        description: "Test sale HIGH netPrice only",
        vatType: "HIGH",
        netPrice: 20304000, // 253800/1.25 = 203040 kr in øre
        incomeAccount: "3000",
      }],
    });
    console.log("SUCCESS:", JSON.stringify(sale1, null, 2));
    // Cleanup
    await client.deleteSale(sale1.saleId, "Test cleanup");
    console.log("Cleaned up sale", sale1.saleId);
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }

  // Test 2: Only grossAmount, vatType HIGH, no netPrice
  console.log("\n=== Test 2: grossAmount only, vatType HIGH ===");
  try {
    const sale2 = await client.createSale({
      date: "2026-01-07",
      kind: "cash_sale",
      paid: true,
      currency: "NOK",
      totalPaid: 25380000,
      paymentAccount: "1920:10001",
      paymentDate: "2026-01-07",
      lines: [{
        description: "Test sale HIGH grossAmount only",
        vatType: "HIGH",
        grossAmount: 25380000, // 253800 kr in øre
        incomeAccount: "3000",
      }],
    });
    console.log("SUCCESS:", JSON.stringify(sale2, null, 2));
    await client.deleteSale(sale2.saleId, "Test cleanup");
    console.log("Cleaned up sale", sale2.saleId);
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }

  // Test 3: Both netPrice and grossAmount, vatType HIGH
  console.log("\n=== Test 3: Both netPrice + grossAmount, vatType HIGH ===");
  try {
    const sale3 = await client.createSale({
      date: "2026-01-07",
      kind: "cash_sale",
      paid: true,
      currency: "NOK",
      totalPaid: 25380000,
      paymentAccount: "1920:10001",
      paymentDate: "2026-01-07",
      lines: [{
        description: "Test sale HIGH both",
        vatType: "HIGH",
        netPrice: 20304000,
        grossAmount: 25380000,
        incomeAccount: "3000",
      }],
    });
    console.log("SUCCESS:", JSON.stringify(sale3, null, 2));
    await client.deleteSale(sale3.saleId, "Test cleanup");
    console.log("Cleaned up sale", sale3.saleId);
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }

  // Test 4: vatType NONE, netPrice only
  console.log("\n=== Test 4: vatType NONE, netPrice only ===");
  try {
    const sale4 = await client.createSale({
      date: "2026-01-07",
      kind: "cash_sale",
      paid: true,
      currency: "NOK",
      totalPaid: 25380000,
      paymentAccount: "1920:10001",
      paymentDate: "2026-01-07",
      lines: [{
        description: "Test sale NONE",
        vatType: "NONE",
        netPrice: 25380000,
        incomeAccount: "3000",
      }],
    });
    console.log("SUCCESS:", JSON.stringify(sale4, null, 2));
    await client.deleteSale(sale4.saleId, "Test cleanup");
    console.log("Cleaned up sale", sale4.saleId);
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }

  // Test 5: vatType EXEMPT, netPrice only
  console.log("\n=== Test 5: vatType EXEMPT, netPrice only ===");
  try {
    const sale5 = await client.createSale({
      date: "2026-01-07",
      kind: "cash_sale",
      paid: true,
      currency: "NOK",
      totalPaid: 25380000,
      paymentAccount: "1920:10001",
      paymentDate: "2026-01-07",
      lines: [{
        description: "Test sale EXEMPT",
        vatType: "EXEMPT",
        netPrice: 25380000,
        incomeAccount: "3000",
      }],
    });
    console.log("SUCCESS:", JSON.stringify(sale5, null, 2));
    await client.deleteSale(sale5.saleId, "Test cleanup");
    console.log("Cleaned up sale", sale5.saleId);
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }

  // Test 6: Small amount with HIGH — 500 kr
  console.log("\n=== Test 6: Small amount 500kr, vatType HIGH, netPrice only ===");
  try {
    const sale6 = await client.createSale({
      date: "2026-01-07",
      kind: "cash_sale",
      paid: true,
      currency: "NOK",
      totalPaid: 50000,
      paymentAccount: "1920:10001",
      paymentDate: "2026-01-07",
      lines: [{
        description: "Test sale small HIGH",
        vatType: "HIGH",
        netPrice: 40000, // 400 kr net = 500 kr gross
        incomeAccount: "3000",
      }],
    });
    console.log("SUCCESS:", JSON.stringify(sale6, null, 2));
    await client.deleteSale(sale6.saleId, "Test cleanup");
    console.log("Cleaned up sale", sale6.saleId);
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }

  console.log("\n=== Done ===");
  process.exit(0);
}

main().catch(console.error);
