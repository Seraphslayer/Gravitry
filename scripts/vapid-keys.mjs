// Makes the key pair that push notifications need. Run once:  npm run vapid
// Then put the three values in Vercel -> Project -> Settings -> Environment Variables.
import webpush from "web-push";
const k = webpush.generateVAPIDKeys();
console.log("\nAdd these three environment variables on Vercel (Production + Preview):\n");
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log("VAPID_SUBJECT=mailto:your-email@example.com");
console.log("\nKeep the private key secret. Do not commit it.\n");
