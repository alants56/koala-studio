import type { ReactElement } from 'react'
import { Button, Result } from 'antd'
import { ProjectOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

/** 工作台：看板已按项目拆分，这里暂时只放占位说明。 */
export function WorkbenchPage(): ReactElement {
  const navigate = useNavigate()

  return (
    <div className="page-frame workbench-coming-soon">
      <Result
        icon={<ProjectOutlined />}
        title="工作台即将上线"
        subTitle="待办看板已按项目拆分。打开左侧任意项目，点右上角「看板」即可查看和管理该项目的待办。"
        extra={<Button type="primary" onClick={() => void navigate('/projects')}>去项目列表</Button>}
      />
    </div>
  )
}
