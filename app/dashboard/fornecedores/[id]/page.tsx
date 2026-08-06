'use client'

import { useParams } from 'next/navigation'

import { OfflineSupplierEditor } from '@/components/suppliers/offline-supplier-editor'

export default function EditarFornecedorPage() {
  const { id } = useParams<{ id: string }>()
  return <OfflineSupplierEditor mode="edit" supplierId={id} />
}
