import type { ReactNode } from 'react'

export type DataTableColumn<T> = {
  key: keyof T | string
  header: string
  render?: (item: T) => ReactNode
  align?: 'left' | 'center' | 'right'
}

interface DataTableProps<T> {
  data: T[]
  columns: DataTableColumn<T>[]
  keyExtractor: (item: T, index: number) => string
  emptyMessage?: string
  rowClassName?: (item: T) => string
}

export function DataTable<T>({ 
  data, 
  columns, 
  keyExtractor, 
  emptyMessage = 'データがありません。',
  rowClassName
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="w-full p-8 text-center text-gray-500 bg-white border border-gray-200 rounded-lg shadow-sm">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="w-full overflow-hidden bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-900 font-semibold">
            <tr>
              {columns.map((col, idx) => (
                <th 
                  key={String(col.key) + idx} 
                  scope="col" 
                  className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.map((item, rowIdx) => (
              <tr 
                key={keyExtractor(item, rowIdx)} 
                className={`hover:bg-gray-50 transition-colors ${rowClassName ? rowClassName(item) : ''}`}
              >
                {columns.map((col, colIdx) => (
                  <td 
                    key={String(col.key) + colIdx} 
                    className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                  >
                    {col.render 
                      ? col.render(item) 
                      : ((item as Record<string, ReactNode | undefined>)[String(col.key)] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
