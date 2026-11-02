import { StyleSheet } from 'react-native'

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
    padding: 14
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a'
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fafafa'
  },
  subtitle: {
    fontSize: 10,
    color: '#71717a',
    marginTop: 2
  },
  headerRight: {
    alignItems: 'flex-end'
  },
  roleLabel: {
    fontSize: 9,
    color: '#38bdf8',
    marginTop: 3
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  pillText: {
    fontSize: 9,
    fontWeight: '700'
  },
  alertBanner: {
    backgroundColor: '#451a03',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#b45309'
  },
  alertText: {
    color: '#fef3c7',
    fontSize: 11
  },
  pairButton: {
    marginTop: 6,
    backgroundColor: '#d97706',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'flex-start'
  },
  pairButtonText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '700'
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a1a1aa',
    marginBottom: 6,
    marginTop: 4
  },
  chipScroll: {
    marginBottom: 12
  },
  chip: {
    backgroundColor: '#18181b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#27272a'
  },
  chipSelected: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8'
  },
  chipText: {
    fontSize: 11,
    color: '#a1a1aa'
  },
  chipTextSelected: {
    color: '#ffffff',
    fontWeight: '600'
  },
  taskList: {
    marginBottom: 14
  },
  taskCard: {
    backgroundColor: '#18181b',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a'
  },
  taskCardSelected: {
    borderColor: '#0284c7',
    backgroundColor: '#0c4a6e22'
  },
  taskCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  taskTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f4f4f5',
    flex: 1
  },
  taskStatus: {
    fontSize: 9,
    color: '#10b981',
    fontWeight: '600',
    marginLeft: 6
  },
  taskExecutor: {
    fontSize: 9,
    color: '#71717a',
    marginTop: 4
  },
  detailCard: {
    backgroundColor: '#141416',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 24
  },
  detailCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fafafa'
  },
  detailCardSubtitle: {
    fontSize: 10,
    color: '#71717a',
    marginTop: 2,
    marginBottom: 8
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 10
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  badgeText: {
    fontSize: 8.5,
    fontWeight: '700'
  },
  badgeAvailable: {
    backgroundColor: '#075985',
    color: '#38bdf8'
  },
  badgeAuthentic: {
    backgroundColor: '#064e3b',
    color: '#34d399'
  },
  badgeSynthetic: {
    backgroundColor: '#713f12',
    color: '#facc15'
  },
  badgeUnverified: {
    backgroundColor: '#7c2d12',
    color: '#fb923c'
  },
  badgeHashOk: {
    backgroundColor: '#064e3b',
    color: '#34d399'
  },
  badgeHashFail: {
    backgroundColor: '#881337',
    color: '#fb7185'
  },
  failureCallout: {
    backgroundColor: '#88133722',
    borderColor: '#f43f5e',
    borderWidth: 1,
    padding: 8,
    borderRadius: 6,
    marginBottom: 8
  },
  failureText: {
    color: '#fda4af',
    fontSize: 10
  },
  zeroChecksCallout: {
    backgroundColor: '#78350f22',
    borderColor: '#f59e0b',
    borderWidth: 1,
    padding: 8,
    borderRadius: 6,
    marginBottom: 8
  },
  zeroChecksText: {
    color: '#fde68a',
    fontSize: 10
  },
  checksContainer: {
    backgroundColor: '#09090b',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8
  },
  checksHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: '#a1a1aa',
    marginBottom: 4,
    textTransform: 'uppercase'
  },
  checkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#18181b'
  },
  checkName: {
    fontSize: 9.5,
    color: '#d4d4d8',
    fontFamily: 'monospace'
  },
  checkStatus: {
    fontSize: 9.5,
    fontWeight: '700',
    fontFamily: 'monospace'
  },
  checkPass: {
    color: '#34d399'
  },
  checkFail: {
    color: '#f43f5e'
  },
  checkOther: {
    color: '#facc15'
  },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  telemetryLabel: {
    fontSize: 10,
    color: '#71717a'
  },
  telemetryValue: {
    fontSize: 10,
    color: '#a1a1aa',
    fontWeight: '600'
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8
  },
  actionBtnPause: {
    flex: 1,
    backgroundColor: '#27272a',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center'
  },
  actionBtnStop: {
    flex: 1,
    backgroundColor: '#3f3f46',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center'
  },
  actionBtnText: {
    fontSize: 10,
    color: '#fafafa',
    fontWeight: '600'
  }
})
