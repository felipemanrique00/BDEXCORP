import { describe, expect, it } from 'vitest'

import {
  airTravelerBirthDateFromMetadata,
  assessAirTravelerProfile,
} from '@/lib/travelers/air-profile'

describe('air traveler profile', () => {
  it('derives canonical first/last names and a safe PNR name', () => {
    expect(assessAirTravelerProfile({
      name: '  João   da Silva  ',
      documentNumber: '529.982.247-25',
      birthDate: '1990-05-20',
    })).toEqual({
      name: 'João da Silva',
      firstName: 'João',
      lastName: 'Silva',
      cpf: '52998224725',
      birthDate: '1990-05-20',
      pnrName: 'SILVA/JOAO',
      profileIssues: [],
    })
  })

  it('reports every field that prevents air travel without rejecting the employee record', () => {
    expect(assessAirTravelerProfile({
      name: 'Madonna',
      documentNumber: '111.111.111-11',
      birthDate: '20/05/1990',
    }).profileIssues).toEqual(['cpf', 'birth_date', 'last_name'])
  })

  it('rejects a PNR whose required name parts cannot be represented in ASCII', () => {
    const result = assessAirTravelerProfile({
      name: '王 小明',
      documentNumber: '52998224725',
      birthDate: '1990-05-20',
    })

    expect(result.pnrName).toBeNull()
    expect(result.profileIssues).toEqual(expect.arrayContaining(['first_name', 'last_name']))
  })

  it('reads the current and legacy birth date metadata keys', () => {
    expect(airTravelerBirthDateFromMetadata({ birthDate: '1985-01-02' })).toBe('1985-01-02')
    expect(airTravelerBirthDateFromMetadata({ data_nascimento: '1986-02-03' })).toBe('1986-02-03')
  })
})
