import { useEffect, useState } from "react";
import { StateService } from "../../services/StateService";

interface DatasetInfo {
  name: string;
  columns: string[];
  rowCount: number;
  data?: any[];
  firstTwoRows?: any[];
}

export function useDatasetDataForStatements(
  datasetInfo: DatasetInfo | null,
  stateService: StateService
) {
  const [datasetDataForStatements, setDatasetDataForStatements] = useState<any[]>([]);

  useEffect(() => {
    const loadDatasetData = async () => {
      if (!datasetInfo) {
        setDatasetDataForStatements([]);
        return;
      }

      try {
        if (datasetInfo.data && datasetInfo.data.length > 0) {
          setDatasetDataForStatements(datasetInfo.data);
          return;
        }
        const fullDataset = await stateService.getDatasetWithData();
        if (fullDataset?.data && fullDataset.data.length > 0) {
          setDatasetDataForStatements(fullDataset.data);
          return;
        }

        if (datasetInfo.firstTwoRows && datasetInfo.firstTwoRows.length > 0) {
          setDatasetDataForStatements(datasetInfo.firstTwoRows);
          return;
        }

        setDatasetDataForStatements([]);
      } catch (error) {
        console.error('❌ [useDatasetDataForStatements] Error loading dataset data:', error);
        setDatasetDataForStatements([]);
      }
    };

    loadDatasetData();
  }, [datasetInfo, stateService]);

  return datasetDataForStatements;
}


