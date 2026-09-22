// Groups a product into a family from its name (used by daily totals and stock views).
module.exports = function productType(name) {
    const n = String(name || '').toLowerCase();
    if (/under\s?shirt|vest|singlet/.test(n)) return 'Undershirts';
    if (/boxer|brief|trunk/.test(n)) return 'Boxers & briefs';
    if (/sock/.test(n)) return 'Socks';
    if (/panty|panties|knicker/.test(n)) return 'Panties';
    return 'Other';
};
