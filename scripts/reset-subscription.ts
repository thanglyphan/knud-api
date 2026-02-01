import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // List all users
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      stripeCustomerId: true,
      subscriptionStatus: true,
      subscriptionStarted: true,
      subscriptionEnds: true,
    },
  });

  console.log('\n=== Current users ===');
  users.forEach((u, i) => {
    console.log(`${i + 1}. ${u.email}`);
    console.log(`   Stripe Customer: ${u.stripeCustomerId || 'none'}`);
    console.log(`   Status: ${u.subscriptionStatus}`);
    console.log(`   Started: ${u.subscriptionStarted || 'none'}`);
    console.log(`   Ends: ${u.subscriptionEnds || 'none'}`);
    console.log('');
  });

  if (users.length === 0) {
    console.log('No users found.');
    return;
  }

  // Reset all users' subscription data
  const result = await prisma.user.updateMany({
    data: {
      stripeCustomerId: null,
      subscriptionStatus: 'none',
      subscriptionStarted: null,
      subscriptionEnds: null,
    },
  });

  console.log(`\n✅ Reset subscription data for ${result.count} user(s)`);
  console.log('You can now test the subscription flow again!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
