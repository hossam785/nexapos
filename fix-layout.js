const fs = require('fs');
const filepath = 'src/pages/cashier/CashierPage.jsx';
const content = fs.readFileSync(filepath, 'utf-8');
const lines = content.split(/\r?\n/);

const actionsStartIdx = lines.findIndex(l => l.includes('<div className=\"border-b border-[#d3ddef] bg-white px-3 py-3\">'));
const rightBottomStartIdx = lines.findIndex((l, i) => i > actionsStartIdx && l.includes('{/* القسم السفلي - العميل والدفع */}'));
const rightPaneEndIdx = lines.findIndex((l, i) => i > rightBottomStartIdx && l.includes('{/* ===== الجزء الأوسط: المنتجات ===== */}'));

const searchStartIdx = lines.findIndex((l, i) => i >= rightPaneEndIdx && l.includes('{/* شريط البحث */}'));
const invoiceStartIdx = lines.findIndex((l, i) => i > searchStartIdx && l.includes('<h2 className=\"text-xl font-black text-[#1f3258]\">فاتورة المبيعات</h2>'));

let productsEndIdx = invoiceStartIdx;
while (productsEndIdx > searchStartIdx && lines[productsEndIdx].trim() !== ') : (') {
    productsEndIdx--;
}

let invoiceEndIdx = productsEndIdx;
let bracketCount = 1; // we know ") : (" is effectively the start of the "else" branch
for (let i = productsEndIdx + 1; i < lines.length; i++) {
    if (lines[i].includes('{false && (')) {
       // just a quick hack to not get confused by nested false
    }
    // A simpler way: the invoice wrapper is `<div className="flex-1 flex flex-col overflow-hidden px-4 pb-4">`
    // which ends near line 2415 with `)}`
}

// Actually, we can just replace `{false ? (` with empty
// and `) : (` with empty
// and the `)}` that closes the `{false ? (` with empty
const falseQIdx = lines.findIndex((l, i) => i > searchStartIdx && l.trim() === '{false ? (');
const colonIdx = productsEndIdx; // this is the ') : ('
const closeBracketIdx = lines.findIndex((l, i) => i > colonIdx && l.trim() === ')}' && lines[i-1].includes('</div>'));

// The products block:
const productsCodeLines = lines.slice(searchStartIdx, colonIdx);
// modify products to be visible
let productsCode = productsCodeLines.join('\n');
productsCode = productsCode.replace('{false && (', '{true && ('); // show categories
productsCode = productsCode.replace('{false ? (', ''); // remove ternary

// The bottom section of right pane to remove:
// from rightBottomStartIdx to rightPaneEndIdx - 1
// We actually just want to remove them.

// Create new file
let newLines = [];
for (let i = 0; i < lines.length; i++) {
    // 1. Remove rightBottomStartIdx to rightPaneEndIdx - 1
    if (i >= rightBottomStartIdx && i < rightPaneEndIdx) {
        continue; // skip bottom section
    }
    
    // 2. Insert productsCode BEFORE actionsStartIdx
    if (i === actionsStartIdx) {
        newLines.push(productsCode);
    }
    
    // 3. Skip the original productsCode and colon
    if (i >= searchStartIdx && i <= colonIdx) {
        continue;
    }
    
    // 4. Remove the closing bracket of the ternary
    if (i === closeBracketIdx) {
        continue; // skip ')}'
    }
    
    newLines.push(lines[i]);
}

fs.writeFileSync('src/pages/cashier/CashierPage.jsx', newLines.join('\n'), 'utf-8');
console.log('Success! Modified CashierPage.jsx in place.');
