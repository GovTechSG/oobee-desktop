import { useTranslation } from "../../i18n";

const SelectField = ({ id, label, initialValue, options, onChange, isDownload, getOptionLabelKey }) => {
  const { t } = useTranslation();

  // Option values stay as the internal (English) identifiers; only the
  // visible text is translated.
  const optionLabel = (option) => {
    const key = getOptionLabelKey ? getOptionLabelKey(option) : null;
    return key ? t(key) : option;
  };

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
      {options.map((option, index) => (
        <option key={index} value={option}>
          {optionLabel(option)}
        </option>
      ))}
      </select>
    </div>
  );
};

export default SelectField;
