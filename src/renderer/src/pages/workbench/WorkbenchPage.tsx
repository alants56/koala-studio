import type { ReactElement } from 'react'
import { Empty } from 'antd'

/** 工作台：保留导航入口，作为后续功能的缺省页面。 */
export function WorkbenchPage(): ReactElement {
  return (
    <div className="flex min-h-full items-center justify-center py-24">
      <Empty description="暂无内容" />
    </div>
  )
}
