const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LICENSE_SECRET = 'MG_POS_2026_SECURE_LICENSE_KEY_X9K4M2';

function signLicense(machineId, expiry) {
  return crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(`${machineId}|${expiry}`)
    .digest('hex');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('====================================');
console.log('   MG POS License Generator 🔑   ');
console.log('====================================\n');

// إدخال الـ Machine ID الخاص بجهاز العميل
rl.question('Enter Client Machine ID: ', (machineId) => {
  machineId = machineId.trim();
  if (!machineId) {
    // خطأ: الـ Machine ID مطلوب!
    console.log('❌ Error: Machine ID is required!');
    rl.close();
    return;
  }

  // اختر نوع الترخيص
  console.log('\nSelect License Type:');
  // 1. مدى الحياة 
  console.log('1. Lifetime');
  // 2. محدد بمدة
  console.log('2. Expiry Date (Limited Time)');
  
  // رقم الاختيار (1 أو 2)
  rl.question('\nChoice (1 or 2): ', (choice) => {
    if (choice === '1') {
      generateLicense(machineId, 'lifetime');
    } else if (choice === '2') {
      // أدخل تاريخ الانتهاء بصيغة 
      rl.question('\nEnter Expiry Date (YYYY-MM-DD) e.g., 2027-12-31: ', (expiryDate) => {
        expiryDate = expiryDate.trim();
        // Validation check for date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(expiryDate)) {
          // خطأ: صيغة التاريخ غير صحيحة!
          console.log('❌ Error: Invalid date format! Must be YYYY-MM-DD');
          rl.close();
          return;
        }
        generateLicense(machineId, expiryDate);
      });
    } else {
      // خطأ: اختيار غير صحيح!
      console.log('❌ Error: Invalid choice!');
      rl.close();
    }
  });
});

function generateLicense(machineId, expiry) {
  const signature = signLicense(machineId, expiry);
  
  const licenseData = {
    machineId: machineId,
    expiry: expiry,
    signature: signature
  };

  // Create output directory if it doesn't exist
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  // Save the file
  const fileName = `license_${machineId}.json`;
  const filePath = path.join(outputDir, fileName);
  
  fs.writeFileSync(filePath, JSON.stringify(licenseData, null, 2), 'utf8');

  // تم إنشاء الترخيص بنجاح!
  console.log('\n✅ License generated successfully!');
  console.log('------------------------------------');
  // تم حفظ الملف في
  console.log(`📍 Saved to: ${filePath}`);
  console.log('------------------------------------');
  // الآن يمكنك إرسال هذا الملف للعميل لتفعيل برنامجه
  console.log('You can now send this file to the client for activation.');
  
  rl.close();
}
