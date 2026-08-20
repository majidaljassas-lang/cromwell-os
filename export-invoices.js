require('dotenv/config');
const { PrismaClient } = require('./src/generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function exportInvoices() {
  try {
    console.log('Fetching invoices with all related data...');

    // Get all invoices with related data
    const invoices = await prisma.salesInvoice.findMany({
      include: {
        customer: {
          select: { id: true, name: true, vatNumber: true }
        },
        site: {
          select: { id: true, siteName: true, siteCode: true, postcode: true }
        },
        lines: {
          include: {
            ticketLine: {
              select: { id: true }
            }
          },
          orderBy: { displayOrder: 'asc' }
        },
        payments: {
          orderBy: { paymentDate: 'asc' }
        },
        ticket: {
          select: { id: true, ticketNo: true }
        }
      },
      orderBy: { issuedAt: 'desc' }
    });

    if (invoices.length === 0) {
      console.log('No invoices found.');
      return;
    }

    console.log(`Found ${invoices.length} invoices. Generating CSV...`);

    // Prepare invoice summary rows and line detail rows
    const allRows = [];
    const headers = [
      'Type',
      'Invoice Number',
      'Ticket No',
      'Customer Name',
      'Customer VAT Number',
      'Site Name',
      'Site Code',
      'Site Postcode',
      'Invoice Type',
      'Status',
      'Issued Date',
      'Due Date',
      'Payment Date',
      'Invoice Total (Net)',
      'VAT Amount',
      'Invoice Total (Gross)',
      'Line Description',
      'Line Qty',
      'Line Unit Price',
      'Line Total',
      'Line VAT Rate',
      'Line VAT Amount',
      'Payment Method',
      'Payment Reference',
      'Payment Amount',
      'Notes'
    ];

    allRows.push(headers);

    // Process each invoice
    for (const invoice of invoices) {
      const paymentInfo = invoice.payments.length > 0
        ? invoice.payments.map(p => ({
            method: p.paymentMethod || '',
            ref: p.reference || '',
            amount: p.amount.toString(),
            date: p.paymentDate ? p.paymentDate.toISOString().split('T')[0] : ''
          }))
        : [{ method: '', ref: '', amount: '', date: '' }];

      if (invoice.lines.length === 0) {
        // Invoice with no lines - add summary row only
        const invoiceDateStr = invoice.issuedAt ? invoice.issuedAt.toISOString().split('T')[0] : '';
        const dueDateStr = invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : '';
        const paidDateStr = invoice.paidAt ? invoice.paidAt.toISOString().split('T')[0] : '';

        for (const payment of paymentInfo) {
          const row = [
            'INVOICE',
            invoice.invoiceNo || '',
            invoice.ticket?.ticketNo || '',
            invoice.customer?.name || '',
            invoice.customer?.vatNumber || '',
            invoice.site?.siteName || '',
            invoice.site?.siteCode || '',
            invoice.site?.postcode || '',
            invoice.invoiceType || '',
            invoice.status || '',
            invoiceDateStr,
            dueDateStr,
            paidDateStr,
            invoice.totalNet.toString(),
            invoice.totalVat.toString(),
            invoice.totalGross.toString(),
            '', // Line Description
            '', // Line Qty
            '', // Line Unit Price
            '', // Line Total
            '', // Line VAT Rate
            '', // Line VAT Amount
            payment.method,
            payment.ref,
            payment.amount,
            invoice.notes || ''
          ];
          allRows.push(row);
        }
      } else {
        // Invoice with lines - add one row per line
        for (let i = 0; i < invoice.lines.length; i++) {
          const line = invoice.lines[i];
          const invoiceDateStr = invoice.issuedAt ? invoice.issuedAt.toISOString().split('T')[0] : '';
          const dueDateStr = invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : '';
          const paidDateStr = invoice.paidAt ? invoice.paidAt.toISOString().split('T')[0] : '';

          // Use first payment for this row (or blank)
          const payment = paymentInfo[0] || { method: '', ref: '', amount: '', date: '' };

          const row = [
            i === 0 ? 'INVOICE' : 'LINE',
            i === 0 ? (invoice.invoiceNo || '') : '', // Show invoice number only on first line
            i === 0 ? (invoice.ticket?.ticketNo || '') : '',
            i === 0 ? (invoice.customer?.name || '') : '',
            i === 0 ? (invoice.customer?.vatNumber || '') : '',
            i === 0 ? (invoice.site?.siteName || '') : '',
            i === 0 ? (invoice.site?.siteCode || '') : '',
            i === 0 ? (invoice.site?.postcode || '') : '',
            i === 0 ? (invoice.invoiceType || '') : '',
            i === 0 ? (invoice.status || '') : '',
            i === 0 ? invoiceDateStr : '',
            i === 0 ? dueDateStr : '',
            i === 0 ? paidDateStr : '',
            i === 0 ? invoice.totalNet.toString() : '',
            i === 0 ? invoice.totalVat.toString() : '',
            i === 0 ? invoice.totalGross.toString() : '',
            line.description || '',
            line.qty.toString(),
            line.unitPrice.toString(),
            line.lineTotal.toString(),
            line.vatRate?.toString() || '',
            line.vatAmount?.toString() || '',
            i === 0 ? payment.method : '',
            i === 0 ? payment.ref : '',
            i === 0 ? payment.amount : '',
            i === 0 ? (invoice.notes || '') : ''
          ];
          allRows.push(row);
        }

        // Add additional payment rows if there are more payments than lines
        if (paymentInfo.length > invoice.lines.length) {
          for (let i = invoice.lines.length; i < paymentInfo.length; i++) {
            const payment = paymentInfo[i];
            const row = [
              'PAYMENT', '', '', '', '', '', '', '', '', '', '', '', '',
              '', '', '', '', '', '', '', '', '',
              payment.method,
              payment.ref,
              payment.amount,
              ''
            ];
            allRows.push(row);
          }
        }
      }
    }

    // Write CSV file
    const csvContent = allRows
      .map(row => row.map(cell => {
        // Escape quotes and wrap in quotes if contains comma or newline
        const cellStr = String(cell).replace(/"/g, '""');
        return cellStr.includes(',') || cellStr.includes('\n') || cellStr.includes('"')
          ? `"${cellStr}"`
          : cellStr;
      }).join(','))
      .join('\n');

    const outputPath = path.join(process.env.HOME || '/tmp', 'Desktop', 'Cromwell_Invoices_Export.csv');
    fs.writeFileSync(outputPath, csvContent, 'utf-8');

    console.log(`✅ Export complete!`);
    console.log(`📊 ${invoices.length} invoices exported`);
    console.log(`📋 ${allRows.length - 1} data rows (including line items)`);
    console.log(`💾 File: ${outputPath}`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

exportInvoices();
