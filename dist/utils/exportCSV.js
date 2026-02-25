"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCSV = generateCSV;
exports.downloadCSV = downloadCSV;
function generateCSV(data, headers) {
    const csvRows = [];
    // Add header row
    csvRows.push(headers.join(','));
    // Add data rows
    data.forEach(item => {
        const values = headers.map(header => {
            const value = item[header];
            // Escape quotes and wrap in quotes if contains comma
            if (value === null || value === undefined)
                return '';
            const stringValue = String(value);
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
        });
        csvRows.push(values.join(','));
    });
    return csvRows.join('\n');
}
function downloadCSV(data, filename) {
    const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
