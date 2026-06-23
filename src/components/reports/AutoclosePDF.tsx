import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 40,
    fontFamily: 'Helvetica',
    color: '#111827',
    fontSize: 10,
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 30,
    paddingBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#111827',
  },
  brandColumn: {
    flexDirection: 'column',
  },
  brandLogo: {
    width: 120,
    height: 40,
    objectFit: 'contain',
    marginBottom: 10,
  },
  brandName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  reportMetaColumn: {
    alignItems: 'flex-end',
  },
  reportTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  metaText: {
    fontSize: 9,
    color: '#6B7280',
    marginBottom: 2,
  },
  kpiContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  kpiCard: {
    flexGrow: 1,
    backgroundColor: '#F9FAFB',
    padding: 12,
    marginRight: 10,
    borderTopWidth: 3,
    borderTopColor: '#111827',
    borderLeftWidth: 1,
    borderLeftColor: '#E5E7EB',
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  kpiLabel: {
    fontSize: 8,
    color: '#6B7280',
    textTransform: 'uppercase',
    marginBottom: 6,
    fontWeight: 'bold',
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 10,
    marginTop: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 4
  },
  table: {
    width: '100%',
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  tableRowStriped: {
    backgroundColor: '#F9FAFB',
  },
  colMerchant: { width: '25%', fontSize: 8, fontWeight: 'bold', color: '#4B5563' },
  colAddress: { width: '25%', fontSize: 8, fontWeight: 'bold', color: '#4B5563' },
  colToken: { width: '15%', fontSize: 8, fontWeight: 'bold', color: '#4B5563', textAlign: 'center' },
  colAmount: { width: '15%', fontSize: 8, fontWeight: 'bold', color: '#4B5563', textAlign: 'right' },
  colStatus: { width: '20%', fontSize: 8, fontWeight: 'bold', color: '#4B5563', textAlign: 'right' },
  
  cellMerchant: { width: '25%', fontSize: 8, color: '#374151' },
  cellAddress: { width: '25%', fontSize: 8, color: '#6B7280' },
  cellToken: { width: '15%', fontSize: 8, color: '#374151', textAlign: 'center' },
  cellAmount: { width: '15%', fontSize: 8, color: '#111827', textAlign: 'right', fontWeight: 'bold' },
  cellStatus: { width: '20%', fontSize: 8, textAlign: 'right' },
  
  statusSuccess: { color: '#059669', fontWeight: 'bold' },
  statusFailed: { color: '#DC2626', fontWeight: 'bold' },
  
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 8,
    color: '#9CA3AF',
  },
});

interface AutoclosePDFProps {
  brandName: string;
  logoUrl?: string;
  brandColor?: string;
  date: string;
  generatedBy: string;
  run: {
    id: string;
    timestamp: number;
    durationMs: number;
    processedSplits: number;
    succeeded: number;
    failed: number;
    totals?: Record<string, number>;
    distributions?: any[];
  };
}

export const AutoclosePDF = ({ brandName, logoUrl, brandColor, date, generatedBy, run }: AutoclosePDFProps) => {
  const color = brandColor || '#111827';
  const customHeaderStyle = StyleSheet.create({
    border: {
      borderBottomColor: color,
    },
    brandNameColor: {
      color: color,
    },
    kpiBorder: {
      borderTopColor: color,
    }
  });

  const formatTx = (tx?: string) => {
    if (!tx) return 'N/A';
    return `${tx.slice(0, 6)}...${tx.slice(-4)}`;
  };

  const formatAddr = (addr?: string) => {
    if (!addr) return 'N/A';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const totals = run.totals || {};
  const hasTotals = Object.keys(totals).length > 0;
  const totalsStr = hasTotals 
    ? Object.entries(totals).map(([token, val]) => `${val.toFixed(4)} ${token}`).join(', ')
    : '0.00 USD';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={[styles.headerContainer, customHeaderStyle.border]}>
          <View style={styles.brandColumn}>
            {logoUrl ? (
              <Image src={logoUrl} style={styles.brandLogo} />
            ) : (
              <Text style={[styles.brandName, customHeaderStyle.brandNameColor]}>{brandName}</Text>
            )}
            <Text style={styles.metaText}>Automated daily settlement engine close</Text>
          </View>
          <View style={styles.reportMetaColumn}>
            <Text style={styles.reportTitle}>AUTOCLOSE SUMMARY REPORT</Text>
            <Text style={styles.metaText}>Date: {date}</Text>
            <Text style={styles.metaText}>Run ID: {run.id.slice(0, 8)}</Text>
            <Text style={styles.metaText}>Generated By: {generatedBy}</Text>
          </View>
        </View>

        {/* KPIs */}
        <View style={styles.kpiContainer}>
          <View style={[styles.kpiCard, customHeaderStyle.kpiBorder]}>
            <Text style={styles.kpiLabel}>Settled Splits</Text>
            <Text style={styles.kpiValue}>{run.processedSplits}</Text>
          </View>
          <View style={[styles.kpiCard, customHeaderStyle.kpiBorder]}>
            <Text style={styles.kpiLabel}>Success Rate</Text>
            <Text style={styles.kpiValue}>
              {run.processedSplits > 0 
                ? `${Math.round((run.succeeded / run.processedSplits) * 100)}%` 
                : '100%'}
            </Text>
          </View>
          <View style={[styles.kpiCard, customHeaderStyle.kpiBorder]}>
            <Text style={styles.kpiLabel}>Distributed Totals</Text>
            <Text style={[styles.kpiValue, { fontSize: 10 }]}>{totalsStr}</Text>
          </View>
          <View style={[styles.kpiCard, customHeaderStyle.kpiBorder]}>
            <Text style={styles.kpiLabel}>Sponsor Gas Cost</Text>
            <Text style={styles.kpiValue}>$0.00 (Gasless)</Text>
          </View>
        </View>

        {/* Section Header */}
        <Text style={styles.sectionHeader}>Settlement Distributions Details</Text>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colMerchant}>Merchant Wallet</Text>
            <Text style={styles.colAddress}>Split Address</Text>
            <Text style={styles.colToken}>Asset</Text>
            <Text style={styles.colAmount}>Amount</Text>
            <Text style={styles.colStatus}>Status / Tx</Text>
          </View>

          {(run.distributions || []).map((d: any, idx: number) => (
            <View key={idx} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowStriped : {}]}>
              <Text style={styles.cellMerchant}>{formatAddr(d.merchantWallet)}</Text>
              <Text style={styles.cellAddress}>{formatAddr(d.splitAddress)}</Text>
              <Text style={styles.cellToken}>{d.token}</Text>
              <Text style={styles.cellAmount}>{d.amount.toFixed(4)}</Text>
              <Text style={styles.cellStatus}>
                {d.status === 'success' ? (
                  <Text style={styles.statusSuccess}>Success ({formatTx(d.txHash)})</Text>
                ) : (
                  <Text style={styles.statusFailed}>Failed ({d.error ? d.error.slice(0, 15) : 'Unknown'})</Text>
                )}
              </Text>
            </View>
          ))}

          {(!run.distributions || run.distributions.length === 0) && (
            <View style={[styles.tableRow, { justifyContent: 'center', paddingVertical: 20 }]}>
              <Text style={{ color: '#9CA3AF', fontSize: 9 }}>No splits with active balances were found during this settlement run.</Text>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>PortalPay Autoclose Settlement System — Powered by BasaltSurge</Text>
          <Text style={styles.footerText}>Confidential Report</Text>
        </View>
      </Page>
    </Document>
  );
};
