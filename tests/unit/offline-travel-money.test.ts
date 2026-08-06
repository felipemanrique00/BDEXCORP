import { describe, expect, it } from 'vitest'

import {
  formatMinorUnits,
  minorUnitsToMoney,
  moneyToMinorUnits,
  sumMoneyInputs,
} from '@/lib/offline-travel/money'

describe('offline travel money', () => {
  it('parses decimal values into exact cents', () => {
    expect(moneyToMinorUnits('1199.99')).toBe(119_999)
    expect(moneyToMinorUnits('0,10')).toBe(10)
    expect(moneyToMinorUnits(0.2)).toBe(20)
    expect(minorUnitsToMoney(119_999)).toBe(1199.99)
  })

  it('rejects negative, imprecise and oversized inputs', () => {
    expect(() => moneyToMinorUnits('-1.00')).toThrow()
    expect(() => moneyToMinorUnits('10.001')).toThrow()
    expect(() => moneyToMinorUnits('1000000000000.00')).toThrow()
  })

  it('derives the total from gross plus taxes in cents', () => {
    expect(sumMoneyInputs('0.10', '0.20')).toBe('0.30')
    expect(sumMoneyInputs('1250', '89.90')).toBe('1339.90')
    expect(formatMinorUnits(133_990)).toBe('1339.90')
    expect(sumMoneyInputs('', '10')).toBe('')
  })
})
