const SelectField = ({ id, label, initialValue, options, onChange, isDownload }) => {


  return (
    <div className="user-input-group">
      <label htmlFor={id} className="bold-text">
        {label}
      </label>
      <select
        id={id}
        className="select-input"
        value={initialValue}
        onChange={onChange}
      >
      {options.map((option, index) => {
        const value = typeof option === 'object' ? option.value : option
        const label2 = typeof option === 'object' ? option.label : option
        return (
          <option key={index} value={value}>
            {label2}
          </option>
        )
      })}
      </select>
    </div>
  );
};

export default SelectField;
