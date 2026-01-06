import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import './CustomFlow.scss';

const CustomFlowPage = ({ completedScanId, setCompletedScanId }) => {
    const { state }= useLocation(); 
    const navigate = useNavigate();
    const [scanDetails, setScanDetails] = useState(null);

    useEffect(() => {
        if (state?.scanDetails) {
          setScanDetails(state.scanDetails);
          window.localStorage.setItem("latestCustomFlowScanDetails", JSON.stringify(state.scanDetails));
          navigate("/result");
        }
    }, [state, navigate])

    return (
      <div id="custom-flow">
        { scanDetails && 
          <div className="custom-flow-content">Loading results...</div>
        }
      </div>
    )
}

export default CustomFlowPage;